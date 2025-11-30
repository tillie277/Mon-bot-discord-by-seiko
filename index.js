// index.js — Version unifiée avec antiraid, smash, backup, etc.
// ⚠️ Assure-toi d’avoir Node + discord.js v14 installé.
// npm i discord.js@14

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType, Partials } = require('discord.js');

// -------------------- CONFIG --------------------
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "726063885492158474"; // Ton ID owner fixe — adapte si besoin
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Ajouts de chemins pour persistance élargie
const PATHS = {
  whitelist: path.join(DATA_DIR, 'whitelist.json'),
  admin: path.join(DATA_DIR, 'admin.json'),
  blacklist: path.join(DATA_DIR, 'blacklist.json'),
  wetList: path.join(DATA_DIR, 'wetList.json'),
  banList: path.join(DATA_DIR, 'banList.json'),
  dogs: path.join(DATA_DIR, 'dogs.json'),
  permMv: path.join(DATA_DIR, 'permMv.json'),
  limitRoles: path.join(DATA_DIR, 'limitRoles.json'),
  lockedNames: path.join(DATA_DIR, 'lockedNames.json'),
  cooldowns: path.join(DATA_DIR, 'cooldowns.json'),
  pv: path.join(DATA_DIR, 'pvChannels.json'),
  lockedTextChannels: path.join(DATA_DIR, 'lockedTextChannels.json'),
  smashChannels: path.join(DATA_DIR, 'smashChannels.json'),        // <--- ajouté pour +smash
  backupsDir: path.join(DATA_DIR, 'backups')                      // <--- dossier pour backups
};
if (!fs.existsSync(PATHS.backupsDir)) fs.mkdirSync(PATHS.backupsDir, { recursive: true });

// -------------------- CLIENT --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// -------------------- IN-MEMORY STORES --------------------
client.whitelist = new Set();
client.adminUsers = new Set();
client.blacklist = new Set();
client.wetList = new Set();
client.banList = new Set();
client.dogs = new Map();               // userId -> { executorId, lockedName }
client.permMvUsers = new Set();
client.limitRoles = new Map();         // roleId -> maxMembers
client.lockedNames = new Set();
client.pvChannels = new Map();
client.lockedTextChannels = new Set();
client.snipes = new Map();             // channelId -> { content, author, timestamp }
let persistentCooldowns = {};
try {
  if (fs.existsSync(PATHS.cooldowns)) {
    persistentCooldowns = JSON.parse(fs.readFileSync(PATHS.cooldowns, 'utf8')) || {};
  }
} catch (e) {
  console.error("load cooldowns error", e);
  persistentCooldowns = {};
}
// toggles / flags
client.antispam = false;
client.antlink = false;
client.antibot = false;
client.antiraid = false;
client.raidlog = false;
// For smash
client.smashChannels = new Set();

// -------------------- PERSISTENCE HELPERS (améliorés) --------------------
function readJSONSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error("readJSONSafe error", p, e);
    return null;
  }
}

function writeAtomic(filePath, data) {
  try {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
    return true;
  } catch (e) {
    console.error("writeAtomic error", filePath, e);
    return false;
  }
}

function persistAll() {
  try {
    writeAtomic(PATHS.whitelist, [...client.whitelist]);
    writeAtomic(PATHS.admin, [...client.adminUsers]);
    writeAtomic(PATHS.blacklist, [...client.blacklist]);
    writeAtomic(PATHS.wetList, [...client.wetList]);
    writeAtomic(PATHS.banList, [...client.banList]);
    writeAtomic(PATHS.dogs, [...client.dogs.entries()]);
    writeAtomic(PATHS.permMv, [...client.permMvUsers]);
    writeAtomic(PATHS.limitRoles, [...client.limitRoles.entries()]);
    writeAtomic(PATHS.lockedNames, [...client.lockedNames]);
    writeAtomic(PATHS.cooldowns, persistentCooldowns);

    const pvObj = {};
    client.pvChannels.forEach((v, k) => {
      pvObj[k] = { allowed: [...v.allowed], ownerId: v.ownerId || null };
    });
    writeAtomic(PATHS.pv, pvObj);
    writeAtomic(PATHS.lockedTextChannels, [...client.lockedTextChannels]);

    const smashArr = Array.from(client.smashChannels);
    writeAtomic(PATHS.smashChannels, smashArr);
  } catch (e) {
    console.error("persistAll top error:", e);
  }
}

function loadAll() {
  try {
    const wl = readJSONSafe(PATHS.whitelist);
    if (Array.isArray(wl)) wl.forEach(id => client.whitelist.add(String(id)));

    const adm = readJSONSafe(PATHS.admin);
    if (Array.isArray(adm)) adm.forEach(id => client.adminUsers.add(String(id)));

    const bl = readJSONSafe(PATHS.blacklist);
    if (Array.isArray(bl)) bl.forEach(id => client.blacklist.add(String(id)));

    const wet = readJSONSafe(PATHS.wetList);
    if (Array.isArray(wet)) wet.forEach(id => client.wetList.add(String(id)));

    const ban = readJSONSafe(PATHS.banList);
    if (Array.isArray(ban)) ban.forEach(id => client.banList.add(String(id)));

    const dogs = readJSONSafe(PATHS.dogs);
    if (Array.isArray(dogs)) dogs.forEach(([k, v]) => client.dogs.set(String(k), v || {}));

    const pmv = readJSONSafe(PATHS.permMv);
    if (Array.isArray(pmv)) pmv.forEach(id => client.permMvUsers.add(String(id)));

    const lr = readJSONSafe(PATHS.limitRoles);
    if (Array.isArray(lr)) lr.forEach(([k, v]) => client.limitRoles.set(String(k), v));

    const ln = readJSONSafe(PATHS.lockedNames);
    if (Array.isArray(ln)) ln.forEach(id => client.lockedNames.add(String(id)));

    const cds = readJSONSafe(PATHS.cooldowns);
    if (cds && typeof cds === 'object') persistentCooldowns = cds;

    const pv = readJSONSafe(PATHS.pv);
    if (pv && typeof pv === 'object') {
      Object.entries(pv).forEach(([k, v]) => {
        client.pvChannels.set(String(k), { allowed: new Set(Array.isArray(v.allowed) ? v.allowed : []), ownerId: v.ownerId || null });
      });
    }

    const lockedTxt = readJSONSafe(PATHS.lockedTextChannels);
    if (Array.isArray(lockedTxt)) lockedTxt.forEach(id => client.lockedTextChannels.add(String(id)));

    const smashArr = readJSONSafe(PATHS.smashChannels);
    client.smashChannels = new Set();
    if (Array.isArray(smashArr)) smashArr.forEach(id => client.smashChannels.add(String(id)));

  } catch (e) {
    console.error("loadAll error:", e);
  }
}

loadAll();
setInterval(persistAll, 60_000);

// -------------------- UTILITAIRES --------------------
const isOwner = id => id === OWNER_ID;
const isWL = id => client.whitelist.has(id) || isOwner(id);
const isAdminMember = member => {
  if (!member) return false;
  if (member.permissions && member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return client.adminUsers.has(member.id);
};

const simpleEmbed = (title, desc) => new EmbedBuilder().setTitle(title).setDescription(desc).setColor(MAIN_COLOR);
const sendNoAccess = msg => msg.channel.send({ embeds: [simpleEmbed("Accès refusé", `${msg.author}, tu n'as pas accès à cette commande !`)] }).catch(()=>{});

const isOnPersistentCooldown = (type, id) => {
  try {
    if (!persistentCooldowns[type]) return false;
    const until = persistentCooldowns[type][id];
    if (!until) return false;
    if (Date.now() > until) {
      delete persistentCooldowns[type][id];
      persistAll();
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
};

const setPersistentCooldown = (type, id, msFromNow) => {
  if (!persistentCooldowns[type]) persistentCooldowns[type] = {};
  persistentCooldowns[type][id] = Date.now() + msFromNow;
  persistAll();
};

const shortCmdCooldownMs = 800;

// parse mention/id utilities
function parseMemberArg(guild, mentionOrId) {
  if (!guild || !mentionOrId) return null;
  const mention = mentionOrId.match(/^<@!?(\d+)>$/);
  const id = mention ? mention[1] : mentionOrId;
  return guild.members.cache.get(id) || null;
}

function parseRoleArg(guild, arg) {
  if (!guild || !arg) return null;
  const mention = arg.match(/^<@&(\d+)>$/);
  const id = mention ? mention[1] : arg;
  return guild.roles.cache.get(id) || null;
}

function ownerOrWLOnly(id) {
  return isOwner(id) || isWL(id);
}

// -------------------- LOG CHANNEL HELPERS --------------------
async function ensureLogChannels(guild) {
  const names = { messages: 'messages-logs', roles: 'role-logs', boosts: 'boost-logs', commands: 'commande-logs', raids: 'raidlogs' };
  const out = {};
  try {
    const existing = guild.channels.cache;
    for (const k of Object.keys(names)) {
      const name = names[k];
      const found = existing.find(ch => ch.name === name && ch.type === ChannelType.GuildText);
      if (found) out[k] = found;
      else {
        try {
          const created = await guild.channels.create({ name, type: ChannelType.GuildText, reason: 'Création salons logs par bot' }).catch(()=>null);
          out[k] = created || null;
        } catch (e) {
          out[k] = null;
        }
      }
    }
  } catch (e) {
    console.error("ensureLogChannels error:", e);
  }
  return out;
}

// Lock/unlock salon texte
async function setTextLock(channel, lock) {
  try {
    if (!channel.guild || channel.type !== ChannelType.GuildText) return false;
    const everyone = channel.guild.roles.everyone;
    if (lock) {
      await channel.permissionOverwrites.edit(everyone, { SendMessages: false }).catch(()=>{});
      const allowIds = new Set([OWNER_ID, ...client.whitelist, ...client.adminUsers]);
      try {
        const members = await channel.guild.members.fetch();
        members.forEach(m => {
          if (m.permissions.has(PermissionsBitField.Flags.Administrator)) allowIds.add(m.id);
        });
      } catch {}
      for (const id of allowIds) {
        if (!id) continue;
        await channel.permissionOverwrites.edit(id, { SendMessages: true }).catch(()=>{});
      }
      client.lockedTextChannels.add(channel.id);
      persistAll();
      return true;
    } else {
      await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: null }).catch(()=>{});
      const idsToRemove = new Set([OWNER_ID, ...client.whitelist, ...client.adminUsers]);
      try {
        const members = await channel.guild.members.fetch();
        members.forEach(m => {
          if (m.permissions.has(PermissionsBitField.Flags.Administrator)) idsToRemove.add(m.id);
        });
      } catch {}
      for (const id of idsToRemove) {
        await channel.permissionOverwrites.edit(id, { SendMessages: null }).catch(()=>{});
      }
      client.lockedTextChannels.delete(channel.id);
      persistAll();
      return true;
    }
  } catch (e) {
    console.error("setTextLock error", e);
    return false;
  }
}

// (I omit voice PV helpers here for brevity — tu les as déjà dans ton code, tu peux les garder)

// -------------------- KEEPALIVE (local + external) --------------------
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
}).listen(process.env.PORT || 10000, () => console.log(`Keepalive HTTP server listening on port ${process.env.PORT || 10000}`));
setInterval(() => {
  try {
    http.get(`http://localhost:${process.env.PORT || 10000}`).on('error', ()=>{});
  } catch(e) {}
}, 4 * 60 * 1000);

function pingExternal(url) {
  try {
    if (!url) return;
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u.href, res => {
      res.on('data', ()=>{});
      res.on('end', ()=>{});
    });
    req.on('error', ()=>{});
    req.end();
  } catch (e) {}
}

if (process.env.SELF_PING_URL) {
  setInterval(() => pingExternal(process.env.SELF_PING_URL), 5 * 60 * 1000);
}

// -------------------- EVENTS --------------------

// Snipe
client.on('messageDelete', async message => {
  try {
    if (!message || !message.author || message.author.bot) return;
    if (message.channel) {
      client.snipes.set(message.channel.id, {
        content: message.content || "",
        author: message.author,
        timestamp: Date.now(),
        attachments: message.attachments.map(a => a.url),
      });
    }
    if (message.guild) {
      const logs = await ensureLogChannels(message.guild);
      const ch = logs.messages;
      if (ch) {
        const embed = new EmbedBuilder()
          .setTitle("Message supprimé")
          .addFields(
            { name: "Auteur", value: `${message.author.tag} (${message.author.id})`, inline: true },
            { name: "Salon", value: `${message.channel.name} (${message.channel.id})`, inline: true },
            { name: "Contenu", value: message.content ? (message.content.length > 1024 ? message.content.slice(0,1000)+"..." : message.content) : "(aucun contenu)" }
          )
          .setColor(MAIN_COLOR)
          .setTimestamp();
        ch.send({ embeds: [embed] }).catch(()=>{});
      }
    }
  } catch (e) {
    console.error("messageDelete handler error:", e);
  }
});

// (Garde le handler messageUpdate existant — inchangé)

// Anti-raid / auto kick on member add, amélioré
client.on('guildMemberAdd', async member => {
  try {
    if (client.blacklist.has(member.id)) {
      setTimeout(async () => {
        await member.kick("Membre blacklisté (auto kick on join)").catch(()=>{});
      }, 3000);
      return;
    }
    if (client.antibot && member.user.bot) {
      await member.kick("Anti-bot activé").catch(()=>{});
      return;
    }
    if (client.antiraid) {
      if (!client._recentJoins) client._recentJoins = new Map();
      const now = Date.now();
      const arr = client._recentJoins.get(member.guild.id) || [];
      arr.push(now);
      client._recentJoins.set(member.guild.id,
        arr.filter(t => now - t < 10000)
      );
      const filtered = client._recentJoins.get(member.guild.id);
      if (filtered.length > 3) { // seuil : 4+ joins en <10s (configurable)
        const members = await member.guild.members.fetch().catch(()=>null);
        if (members) {
          for (const [id, m] of members) {
            if (now - (m.joinedTimestamp || 0) < 15000 &&
                !m.permissions.has(PermissionsBitField.Flags.Administrator)) {
              try { await m.kick("Anti-raid : joins massifs détectés").catch(()=>{}); } catch {}
            }
          }
        }
        if (client.raidlog && member.guild.systemChannel) {
          const embed = new EmbedBuilder()
            .setTitle("Anti-raid activé")
            .setDescription("Joins massifs détectés. Actions automatiques exécutées.")
            .setColor(MAIN_COLOR)
            .setTimestamp();
          member.guild.systemChannel.send({ embeds: [embed] }).catch(()=>{});
        }
      }
    }
  } catch (e) {
    console.error("guildMemberAdd error:", e);
  }
});

// (Garde guildMemberUpdate, voiceStateUpdate, etc.)

// -------------------- COMMAND HANDLER --------------------
client.on('messageCreate', async message => {
  try {
    if (!message || !message.author || message.author.bot) return;
    // anti-spam basic
    if (client.antispam && !isOwner(message.author.id)) {
      // tu peux conserver ton spam tracker ou en refaire un nouveau
    }
    // +smash salon : si salon est dans smashChannels
    if (client.smashChannels.has(message.channel.id)) {
      // si contenu texte (non attachments), supprimer
      if (!message.attachments.size && !message.stickers.size) {
        await message.delete().catch(()=>{});
        return;
      }
    }

    if (!message.content.startsWith('+')) return;
    const args = message.content.slice(1).trim().split(/\s+/).filter(Boolean);
    if (!args.length) return;
    const command = args.shift().toLowerCase();

    // BACKUP commands
    if (command === 'backup') {
      if (!ownerOrWLOnly(message.author.id)) return sendNoAccess(message);
      const sub = args[0] ? args[0].toLowerCase() : null;
      if (sub === 'save') {
        const state = {
          meta: { createdAt: new Date().toISOString(), guild: message.guild ? { id: message.guild.id, name: message.guild.name } : null },
          whitelist: [...client.whitelist],
          adminUsers: [...client.adminUsers],
          blacklist: [...client.blacklist],
          wetList: [...client.wetList],
          banList: [...client.banList],
          dogs: [...client.dogs.entries()],
          permMv: [...client.permMvUsers],
          limitRoles: [...client.limitRoles.entries()],
          lockedNames: [...client.lockedNames],
          pv: (() => {
            const o = {};
            client.pvChannels.forEach((v, k) => { o[k]= { allowed: [...v.allowed], ownerId: v.ownerId || null }; });
            return o;
          })(),
          lockedTextChannels: [...client.lockedTextChannels],
          smashChannels: [...client.smashChannels],
          persistentCooldowns
        };
        const fname = `backup_${message.guild ? message.guild.id : 'global'}_${Date.now()}.json`;
        const outPath = path.join(PATHS.backupsDir, fname);
        try {
          fs.writeFileSync(outPath, JSON.stringify(state, null, 2));
          return message.channel.send(`✓ Backup saved: \`${fname}\``);
        } catch (e) {
          console.error("backup save error", e);
          return message.channel.send("✘ Erreur lors de la sauvegarde du backup.");
        }
      } else if (sub === 'load') {
        const fname = args[1];
        if (!fname) return message.reply("Usage: +backup load <filename.json>");
        const inPath = path.join(PATHS.backupsDir, fname);
        if (!fs.existsSync(inPath)) return message.reply("Fichier backup introuvable.");
        try {
          const state = JSON.parse(fs.readFileSync(inPath, 'utf8'));
          // restore states — écrase tout
          client.whitelist = new Set(state.whitelist || []);
          client.adminUsers = new Set(state.adminUsers || []);
          client.blacklist = new Set(state.blacklist || []);
          client.wetList = new Set(state.wetList || []);
          client.banList = new Set(state.banList || []);
          client.dogs = new Map(state.dogs || []);
          client.permMvUsers = new Set(state.permMv || []);
          client.limitRoles = new Map(state.limitRoles || []);
          client.lockedNames = new Set(state.lockedNames || []);
          client.pvChannels = new Map(Object.entries(state.pv || {}).map(([k,v]) => [k, { allowed: new Set(v.allowed || []), ownerId: v.ownerId || null }]));
          client.lockedTextChannels = new Set(state.lockedTextChannels || []);
          client.smashChannels = new Set(state.smashChannels || []);
          persistentCooldowns = state.persistentCooldowns || {};
          persistAll();
          return message.channel.send(`✓ Backup \`${fname}\` chargé.`);
        } catch (e) {
          console.error("backup load error", e);
          return message.channel.send("✘ Erreur lors du chargement du backup.");
        }
      }
    }

    // ... ici tu remets toutes les autres commandes que tu avais déjà (ping, help, pic, dog, undog, mv, etc.)
    // Je ne recopie pas **tout** ici pour éviter un fichier monstrueux — mais **tu gardes ton code existant**.
    // Par contre, je te montre le bloc +smash ci-dessous, et le toggle pour +smash.

    if (command === 'smash') {
      // usage: +smash → toggle salon smash
      if (!ownerOrWLOnly(message.author.id)) return sendNoAccess(message);
      const chanId = message.channel.id;
      const now = client.smashChannels.has(chanId);
      if (now) {
        client.smashChannels.delete(chanId);
        persistAll();
        return message.channel.send("✘ Smash désactivé pour ce salon (texte + médias autorisés).");
      } else {
        client.smashChannels.add(chanId);
        persistAll();
        return message.channel.send("✓ Smash activé : seules images/vidéos autorisées, réactions automatiques & threads.");
      }
    }

    // +snipe (adapté pour inclure attachments)
    if (command === 'snipe') {
      const snipe = client.snipes.get(message.channel.id);
      if (!snipe) return message.reply("Aucun message à snipe !");
      const date = new Date(snipe.timestamp || Date.now());
      const embed = new EmbedBuilder()
        .setAuthor({ name: snipe.author.tag, iconURL: snipe.author.displayAvatarURL?.({ dynamic: true }) })
        .setDescription(snipe.content || "(pas de texte)")
        .addFields(
          { name: "Supprimé le", value: `${date.toLocaleString()}`, inline: true }
        )
        .setColor(MAIN_COLOR);

      if (snipe.attachments && snipe.attachments.length) {
        embed.addFields({ name: "Pièces jointes", value: snipe.attachments.join("\n") });
        embed.setImage(snipe.attachments[0]); // montre la 1ʳᵉ — ou adapter si plusieurs
      }

      const sent = await message.channel.send({ embeds: [embed] }).catch(()=>null);
      if (sent) setTimeout(() => sent.delete().catch(()=>{}), 30000);
      return;
    }

    // (Ici tu remets le reste de ton handler existant : help, pic, dog, undog, bl, wet, etc.)

  } catch (e) {
    console.error("messageCreate handler overall error:", e);
  }
});

// -------------------- REACTIONS & THREADS pour +smash --------------------
client.on('messageCreate', async message => {
  try {
    if (!message.guild) return;
    if (!client.smashChannels.has(message.channel.id)) return;

    // Si on a une image ou vidéo attachée et pas un bot
    if (message.author.bot) return;
    if (!message.attachments.size) return;

    // Ajout des réactions ✓ et ✘
    await message.react('✓').catch(()=>{});
    await message.react('✘').catch(()=>{});

    // Création auto d’un thread pour les avis
    try {
      const thr = await message.startThread({
        name: `smash–${message.author.username}-${Date.now()}`,
        autoArchiveDuration: 1440, // 24h ; tu peux ajuster
        reason: 'Thread auto pour smash or pass',
      });
      // tu peux configurer permissions du thread si besoin
    } catch (e) {
      console.error("Erreur création thread +smash :", e);
    }

  } catch (e) {
    console.error("smash media handler error:", e);
  }
});

// -------------------- LOGIN --------------------
client.login(process.env.DISCORD_TOKEN || 'TON_TOKEN_ICI').then(() => {
  console.log("Bot connecté.");
}).catch(err => {
  console.error("Erreur login:", err);
  process.exit(1);
});
