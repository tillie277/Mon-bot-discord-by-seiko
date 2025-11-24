require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType, AuditLogEvent } = require('discord.js');

// -------------------- CONFIG --------------------
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = process.env.OWNER_ID || "726063885492158474"; // change si besoin
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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
  lockedTextChannels: path.join(DATA_DIR, 'lockedTextChannels.json')
};

const EXTERNAL_PING_URL = process.env.SELF_PING_URL || "https://mon-bot-discord-by-seiko.onrender.com/";
const PORT = process.env.PORT || 10000;

// -------------------- CLIENT --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// -------------------- IN-MEMORY STORES --------------------
client.whitelist = new Set();
client.adminUsers = new Set();
client.blacklist = new Set();
client.wetList = new Set();
client.banList = new Set();
client.dogs = new Map(); // targetId -> { executorId, lockedName, originalNick }
client.permMvUsers = new Set();
client.limitRoles = new Map();
client.lockedNames = new Set();

// pvChannels: Map channelId -> { allowed: Set<userId>, ownerId: who set it }
client.pvChannels = new Map();

// lockedTextChannels: Set of channelId that are locked (no send for @everyone)
client.lockedTextChannels = new Set();

client.snipes = new Map(); // channelId -> {content, author, timestamp}
client.messageLastTs = new Map(); // per-user last message timestamp (short)
client.processingMessageIds = new Set(); // prevent duplicate processing per message.id

// persistent cooldowns (snap/wakeup): { snap: { userId: expiryTs }, wakeup: {...} }
let persistentCooldowns = {};
try {
  if (fs.existsSync(PATHS.cooldowns)) persistentCooldowns = JSON.parse(fs.readFileSync(PATHS.cooldowns, 'utf8')) || {};
} catch (e) { console.error("load cooldowns error", e); persistentCooldowns = {}; }

// toggles
client.antispam = false;
client.antlink = false;
client.antibot = false;
client.antiraid = false;
client.raidlog = false;

// -------------------- PERSISTENCE HELPERS --------------------
function readJSONSafe(p) {
  try { if (!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error("readJSONSafe error", p, e); return null; }
}
function writeJSONSafe(p, data) {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
  catch (e) { console.error("writeJSONSafe error", p, e); }
}
function persistAll() {
  writeJSONSafe(PATHS.whitelist, [...client.whitelist]);
  writeJSONSafe(PATHS.admin, [...client.adminUsers]);
  writeJSONSafe(PATHS.blacklist, [...client.blacklist]);
  writeJSONSafe(PATHS.wetList, [...client.wetList]);
  writeJSONSafe(PATHS.banList, [...client.banList]);
  writeJSONSafe(PATHS.dogs, [...client.dogs.entries()]);
  writeJSONSafe(PATHS.permMv, [...client.permMvUsers]);
  writeJSONSafe(PATHS.limitRoles, [...client.limitRoles.entries()]);
  writeJSONSafe(PATHS.lockedNames, [...client.lockedNames]);
  writeJSONSafe(PATHS.cooldowns, persistentCooldowns);
  // pv persistence
  const pvObj = {};
  client.pvChannels.forEach((v, k) => {
    pvObj[k] = { allowed: [...v.allowed], ownerId: v.ownerId || null };
  });
  writeJSONSafe(PATHS.pv, pvObj);
  writeJSONSafe(PATHS.lockedTextChannels, [...client.lockedTextChannels]);
}
function loadAll() {
  const wl = readJSONSafe(PATHS.whitelist); if (Array.isArray(wl)) wl.forEach(id => client.whitelist.add(id));
  const adm = readJSONSafe(PATHS.admin); if (Array.isArray(adm)) adm.forEach(id => client.adminUsers.add(id));
  const bl = readJSONSafe(PATHS.blacklist); if (Array.isArray(bl)) bl.forEach(id => client.blacklist.add(id));
  const wet = readJSONSafe(PATHS.wetList); if (Array.isArray(wet)) wet.forEach(id => client.wetList.add(id));
  const ban = readJSONSafe(PATHS.banList); if (Array.isArray(ban)) ban.forEach(id => client.banList.add(id));
  const dogs = readJSONSafe(PATHS.dogs); if (Array.isArray(dogs)) dogs.forEach(([k,v]) => client.dogs.set(k, v));
  const pmv = readJSONSafe(PATHS.permMv); if (Array.isArray(pmv)) pmv.forEach(id => client.permMvUsers.add(id));
  const lr = readJSONSafe(PATHS.limitRoles); if (Array.isArray(lr)) lr.forEach(([k,v]) => client.limitRoles.set(k,v));
  const ln = readJSONSafe(PATHS.lockedNames); if (Array.isArray(ln)) ln.forEach(id => client.lockedNames.add(id));
  const cds = readJSONSafe(PATHS.cooldowns); if (cds && typeof cds === 'object') persistentCooldowns = cds;
  const pv = readJSONSafe(PATHS.pv); if (pv && typeof pv === 'object') {
    Object.entries(pv).forEach(([k,v]) => {
      client.pvChannels.set(k, { allowed: new Set(Array.isArray(v.allowed) ? v.allowed : []), ownerId: v.ownerId || null });
    });
  }
  const lockedTxt = readJSONSafe(PATHS.lockedTextChannels); if (Array.isArray(lockedTxt)) lockedTxt.forEach(id => client.lockedTextChannels.add(id));
}
loadAll();
setInterval(persistAll, 60_000);

// -------------------- UTILS --------------------
const isOwner = id => id === OWNER_ID;
const isWL = id => client.whitelist.has(id) || isOwner(id);
const isAdminMember = member => {
  try {
    if (!member) return false;
    if (member.permissions && member.permissions.has && member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    return client.adminUsers.has(member.id);
  } catch { return false; }
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
  } catch (e) { return false; }
};
const setPersistentCooldown = (type, id, msFromNow) => {
  if (!persistentCooldowns[type]) persistentCooldowns[type] = {};
  persistentCooldowns[type][id] = Date.now() + msFromNow;
  persistAll();
};
const shortCmdCooldownMs = 800; // anti-double-command per-user short
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
const ownerOrWLOnly = id => isOwner(id) || isWL(id);

// -------------------- LOG CHANNEL HELPERS --------------------
async function ensureLogChannels(guild) {
  const names = {
    messages: 'messages-logs',
    roles: 'role-logs',
    boosts: 'boost-logs',
    commands: 'commande-logs',
    raids: 'raidlogs'
  };
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
        } catch (e) { out[k] = null; }
      }
    }
  } catch (e) {
    console.error("ensureLogChannels error:", e);
  }
  return out;
}

// Permission helper to set text lock
async function setTextLock(channel, lock) {
  try {
    const guild = channel.guild;
    if (!guild || channel.type !== ChannelType.GuildText) return false;
    const everyone = guild.roles.everyone;
    if (lock) {
      await channel.permissionOverwrites.edit(everyone, { SendMessages: false }).catch(()=>{});
      const allowIds = new Set([OWNER_ID, ...client.whitelist, ...client.adminUsers]);
      try {
        const members = await guild.members.fetch();
        members.forEach(m => { if (m.permissions && m.permissions.has && m.permissions.has(PermissionsBitField.Flags.Administrator)) allowIds.add(m.id); });
      } catch {}
      for (const id of allowIds) {
        if (!id) continue;
        await channel.permissionOverwrites.edit(id, { SendMessages: true }).catch(()=>{});
      }
      client.lockedTextChannels.add(channel.id);
      persistAll();
      return true;
    } else {
      await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }).catch(()=>{});
      const idsToRemove = new Set([OWNER_ID, ...client.whitelist, ...client.adminUsers]);
      try {
        const members = await guild.members.fetch();
        members.forEach(m => { if (m.permissions && m.permissions.has && m.permissions.has(PermissionsBitField.Flags.Administrator)) idsToRemove.add(m.id); });
      } catch {}
      for (const id of idsToRemove) {
        try { await channel.permissionOverwrites.edit(id, { SendMessages: null }).catch(()=>{}); } catch {}
      }
      client.lockedTextChannels.delete(channel.id);
      persistAll();
      return true;
    }
  } catch (e) { console.error("setTextLock error", e); return false; }
}

// Voice PV helpers
async function makeVoicePrivate(voiceChannel, setterMember) {
  try {
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) return false;
    const allowed = new Set([...voiceChannel.members.keys()]);
    if (setterMember && setterMember.id) allowed.add(setterMember.id);
    client.pvChannels.set(voiceChannel.id, { allowed, ownerId: setterMember ? setterMember.id : null });
    await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.roles.everyone, { Connect: false }).catch(()=>{});
    for (const id of allowed) {
      await voiceChannel.permissionOverwrites.edit(id, { Connect: true }).catch(()=>{});
    }
    persistAll();
    return true;
  } catch (e) { console.error("makeVoicePrivate error", e); return false; }
}
async function makeVoicePublic(voiceChannel) {
  try {
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) return false;
    await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.roles.everyone, { Connect: null }).catch(()=>{});
    const pv = client.pvChannels.get(voiceChannel.id);
    if (pv && pv.allowed) {
      for (const id of pv.allowed) {
        try { await voiceChannel.permissionOverwrites.edit(id, { Connect: null }).catch(()=>{}); } catch {}
      }
    }
    client.pvChannels.delete(voiceChannel.id);
    persistAll();
    return true;
  } catch (e) { console.error("makeVoicePublic error", e); return false; }
}
async function addVoiceAccess(voiceChannel, userId) {
  try {
    const pv = client.pvChannels.get(voiceChannel.id);
    if (!pv) return false;
    pv.allowed.add(userId);
    await voiceChannel.permissionOverwrites.edit(userId, { Connect: true }).catch(()=>{});
    client.pvChannels.set(voiceChannel.id, pv);
    persistAll();
    return true;
  } catch (e) { console.error("addVoiceAccess error", e); return false; }
}
async function delVoiceAccess(voiceChannel, userId) {
  try {
    const pv = client.pvChannels.get(voiceChannel.id);
    if (!pv) return false;
    pv.allowed.delete(userId);
    await voiceChannel.permissionOverwrites.edit(userId, { Connect: null }).catch(()=>{});
    client.pvChannels.set(voiceChannel.id, pv);
    persistAll();
    return true;
  } catch (e) { console.error("delVoiceAccess error", e); return false; }
}
async function grantAccessToAllInVoice(voiceChannel) {
  try {
    const members = voiceChannel.members.map(m => m.id);
    let pv = client.pvChannels.get(voiceChannel.id);
    if (!pv) { pv = { allowed: new Set(), ownerId: null }; client.pvChannels.set(voiceChannel.id, pv); }
    for (const id of members) {
      pv.allowed.add(id);
      await voiceChannel.permissionOverwrites.edit(id, { Connect: true }).catch(()=>{});
    }
    client.pvChannels.set(voiceChannel.id, pv);
    persistAll();
    return true;
  } catch (e) { console.error("grantAccessToAllInVoice error", e); return false; }
}

// -------------------- KEEPALIVE (local + external) --------------------
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
}).listen(PORT, () => console.log(`Keepalive HTTP server listening on port ${PORT}`));
setInterval(() => { try { http.get(`http://localhost:${PORT}`).on('error', ()=>{}); } catch(e) {} }, 4 * 60 * 1000);
function pingExternal(url) {
  try {
    if (!url) return;
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u.href, res => { res.on('data', ()=>{}); res.on('end', ()=>{}); });
    req.on('error', ()=>{});
    req.end();
  } catch (e) {}
}
setInterval(() => pingExternal(EXTERNAL_PING_URL), 5 * 60 * 1000); // ping externe toutes les 5 min

// -------------------- EVENTS --------------------
client.on('messageDelete', async message => {
  try {
    if (!message || !message.author || message.author.bot) return;
    if (message.channel) client.snipes.set(message.channel.id, { content: message.content || "", author: message.author, timestamp: Date.now() });
    if (message.guild) {
      try {
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
      } catch (e) {}
    }
  } catch (e) { console.error("messageDelete handler error:", e); }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  try {
    if (!oldMessage || !oldMessage.author) return;
    if (oldMessage.author.bot) return;
    if (oldMessage.content === newMessage.content) return;
    if (oldMessage.guild) {
      try {
        const logs = await ensureLogChannels(oldMessage.guild);
        const ch = logs.messages;
        if (ch) {
          const embed = new EmbedBuilder()
            .setTitle("Message modifié")
            .addFields(
              { name: "Auteur", value: `${oldMessage.author.tag} (${oldMessage.author.id})`, inline: true },
              { name: "Salon", value: `${oldMessage.channel.name} (${oldMessage.channel.id})`, inline: true },
              { name: "Avant", value: oldMessage.content ? (oldMessage.content.length > 1024 ? oldMessage.content.slice(0,1000)+"..." : oldMessage.content) : "(vide)" },
              { name: "Après", value: newMessage.content ? (newMessage.content.length > 1024 ? newMessage.content.slice(0,1000)+"..." : newMessage.content) : "(vide)" }
            )
            .setColor(MAIN_COLOR)
            .setTimestamp();
          ch.send({ embeds: [embed] }).catch(()=>{});
        }
      } catch (e) {}
    }
  } catch (e) { console.error("messageUpdate handler error:", e); }
});

// ULTRA-LOCK: on member update, enforce dog lockedName and lockedNames set; attempt to undo and punish renamer
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    // lockedNames enforcement: revert nickname changes
    if (client.lockedNames && client.lockedNames.has(newMember.id)) {
      if (oldMember?.nickname !== newMember?.nickname) {
        try { await newMember.setNickname(oldMember?.nickname || newMember.user.username).catch(()=>{}); } catch (e) {}
        try { await newMember.send("Ton pseudo est verrouillé sur ce serveur — tu ne peux pas le changer pour l'instant.").catch(()=>{}); } catch {}
      }
    }
    // ULTRA DOG enforcement: revert to lockedName and attempt to punish executor
    if (client.dogs && client.dogs.has(newMember.id)) {
      const info = client.dogs.get(newMember.id);
      if (info && info.lockedName && newMember.displayName !== info.lockedName) {
        // revert immediately
        try { await newMember.setNickname(info.lockedName).catch(()=>{}); } catch (e) {}
        // Fetch audit logs to see who did the change
        try {
          const logs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 5 }).catch(()=>null);
          if (logs && logs.entries) {
            const entry = logs.entries.find(en => {
              try {
                const t = en.target;
                return t && t.id === newMember.id;
              } catch { return false; }
            });
            if (entry) {
              const executor = entry.executor;
              if (executor && executor.id !== client.user.id && executor.id !== info.executorId && executor.id !== OWNER_ID) {
                // Notify executor and owner
                try {
                  await executor.send(`⚠️ Tu as tenté de changer le pseudo de ${newMember.user.tag} verrouillé sur ${newMember.guild.name}. Action annulée.`).catch(()=>{});
                } catch {}
                // Attempt to remove ManageNicknames from executor's highest role (best-effort, only if bot can manage roles)
                try {
                  const execMember = await newMember.guild.members.fetch(executor.id).catch(()=>null);
                  if (execMember && newMember.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                    // find highest role of executor that bot can edit
                    const editableRoles = execMember.roles.cache.filter(r => newMember.guild.members.me.roles.highest.position > r.position);
                    const candidate = editableRoles.sort((a,b) => b.position - a.position).first();
                    if (candidate) {
                      // remove ManageNicknames flag from that role's permissions (if it had)
                      const perms = candidate.permissions;
                      if (perms.has(PermissionsBitField.Flags.ManageNicknames)) {
                        const newPerm = perms.remove(PermissionsBitField.Flags.ManageNicknames);
                        await candidate.setPermissions(newPerm).catch(()=>{});
                        // log to owner
                        try { const ownerUser = await client.users.fetch(OWNER_ID).catch(()=>null); if (ownerUser) ownerUser.send(`Le rôle ${candidate.name} (${candidate.id}) a eu ManageNicknames retiré automatiquement suite à une tentative de renommage d'un dog par <@${executor.id}> sur ${newMember.guild.name}.`).catch(()=>{}); } catch {}
                      }
                    } else {
                      // can't edit any role -> notify owner
                      try { const ownerUser = await client.users.fetch(OWNER_ID).catch(()=>null); if (ownerUser) ownerUser.send(`J'ai détecté que <@${executor.id}> a tenté de renommer ${newMember.user.tag} (dog locked) sur ${newMember.guild.name}, mais je ne peux pas modifier ses rôles (position).`).catch(()=>{}); } catch {}
                    }
                  } else {
                    try { const ownerUser = await client.users.fetch(OWNER_ID).catch(()=>null); if (ownerUser) ownerUser.send(`Tentative de renommage détectée par <@${executor.id}> sur ${newMember.guild.name} mais je n'ai pas ManageRoles.`).catch(()=>{}); } catch {}
                  }
                } catch (e) { console.error("punish attempt error:", e); }
              }
            }
          }
        } catch (e) { /* ignore audit errors */ }
      }
    }

    // ROLE change logging (existing)
    try {
      const g = newMember.guild;
      const logs = await ensureLogChannels(g);
      const roleCh = logs.roles;
      if (roleCh) {
        const oldRoles = new Set(oldMember.roles.cache.keys());
        const newRoles = new Set(newMember.roles.cache.keys());
        for (const r of newMember.roles.cache.values()) {
          if (!oldRoles.has(r.id)) {
            const embed = new EmbedBuilder()
              .setTitle("Rôle ajouté")
              .addFields(
                { name: "Membre", value: `${newMember.user.tag} (${newMember.id})`, inline:true },
                { name: "Rôle", value: `${r.name} (${r.id})`, inline:true },
                { name: "Heure", value: new Date().toLocaleString(), inline: false }
              )
              .setColor(MAIN_COLOR)
              .setTimestamp();
            roleCh.send({ embeds: [embed] }).catch(()=>{});
          }
        }
        for (const rId of oldRoles) {
          if (!newRoles.has(rId)) {
            const r = oldMember.guild.roles.cache.get(rId);
            const embed = new EmbedBuilder()
              .setTitle("Rôle retiré")
              .addFields(
                { name: "Membre", value: `${newMember.user.tag} (${newMember.id})`, inline:true },
                { name: "Rôle", value: `${r ? r.name : rId} (${rId})`, inline:true },
                { name: "Heure", value: new Date().toLocaleString(), inline: false }
              )
              .setColor(MAIN_COLOR)
              .setTimestamp();
            roleCh.send({ embeds: [embed] }).catch(()=>{});
          }
        }
      }
    } catch (e) { /* ignore role log errors */ }

  } catch (e) { console.error("guildMemberUpdate error:", e); }
});

client.on('guildMemberAdd', async member => {
  try {
    if (client.blacklist.has(member.id)) {
      setTimeout(async () => { try { await member.kick("Membre blacklisté (auto kick on join)"); } catch {} }, 3000);
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
      client._recentJoins.set(member.guild.id, arr.filter(t => now - t < 10000));
      const filtered = client._recentJoins.get(member.guild.id);
      if (filtered.length > 3) {
        const members = await member.guild.members.fetch().catch(()=>null);
        if (members) {
          for (const [id, m] of members) {
            if (now - (m.joinedTimestamp || 0) < 15000 && !m.permissions.has(PermissionsBitField.Flags.Administrator)) {
              try { await m.kick("Anti-raid: joins massifs détectés").catch(()=>{}); } catch {}
            }
          }
        }
        if (client.raidlog && member.guild.systemChannel) {
          const embed = new EmbedBuilder().setTitle("Anti-raid activé").setDescription("Joins massifs détectés. Actions prises automatiquement.").setColor(MAIN_COLOR).setTimestamp();
          member.guild.systemChannel.send({ embeds: [embed] }).catch(()=>{});
        }
      }
    }
  } catch (e) { console.error("guildMemberAdd error:", e); }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  try {
    if (!newState || !newState.guild) return;
    if (newState.channelId) {
      const pv = client.pvChannels.get(newState.channelId);
      if (pv) {
        const uid = newState.member?.id;
        if (uid && !pv.allowed.has(uid) && !isOwner(uid) && !isWL(uid) && !isAdminMember(newState.member)) {
          setTimeout(() => {
            const m = newState.guild.members.cache.get(uid);
            if (m && m.voice && m.voice.channelId === newState.channelId) {
              try { m.voice.setChannel(null).catch(()=>{}); } catch {}
            }
          }, 1000);
        }
      }
    }

    client.dogs.forEach((info, dogId) => {
      const master = newState.guild.members.cache.get(info.executorId);
      const dog = newState.guild.members.cache.get(dogId);
      if (!master || !dog) return;
      if (newState.member?.id === info.executorId && newState.channelId) {
        if ((dog.voice && dog.voice.channelId) !== newState.channelId) dog.voice.setChannel(newState.channelId).catch(()=>{});
      }
      if (newState.member?.id === dogId && master.voice && master.voice.channelId && dog.voice && dog.voice.channelId !== master.voice.channelId) {
        dog.voice.setChannel(master.voice.channelId).catch(()=>{});
      }
    });

  } catch (e) { console.error("voiceStateUpdate dogs error:", e); }
});

// -------------------- COMMAND LIST (used by +help) --------------------
const COMMANDS_DESC = [
  { category: "GENERAL", lines: [
    { cmd: "+help", desc: "Affiche la liste courte (Owner/WL/Admin)", access: "all" },
    { cmd: "+ping", desc: "Répond 'ta cru j'étais off btrd?'", access: "all" }
  ]},
  { category: "ROLES", lines: [
    { cmd: "+pic @user", desc: "Affiche avatar (all)", access: "all" },
    { cmd: "+banner @user", desc: "Affiche bannière (all)", access: "all" },
    { cmd: "+addrole @user roleID", desc: "Ajoute un rôle (Owner/WL/Admin)", access: "admin" },
    { cmd: "+delrole @user roleID", desc: "Retire un rôle (Owner/WL/Admin)", access: "admin" },
    { cmd: "+derank @user", desc: "Retire tous les rôles (Owner/WL/Admin)", access: "admin" }
  ]},
  { category: "LIMIT ROLES", lines: [
    { cmd: "+limitrole @role <max>", desc: "Limite rôle (Owner/WL)", access: "wl" },
    { cmd: "+unlimitrole @role", desc: "Supprime limite (Owner/WL)", access: "wl" }
  ]},
  { category: "ANTIS", lines: [
    { cmd: "+antispam", desc: "Toggle antispam (Owner/WL/Admin)", access: "admin" },
    { cmd: "+antibot", desc: "Toggle anti-bot (Owner/WL/Admin)", access: "admin" },
    { cmd: "+antlink", desc: "Toggle anti-lien (Owner/WL/Admin)", access: "admin" },
    { cmd: "+antiraid", desc: "Toggle anti-raid (Owner)", access: "owner" },
    { cmd: "+raidlog", desc: "Toggle log anti-raid (Owner/WL/Admin)", access: "admin" }
  ]},
  { category: "MISC", lines: [
    { cmd: "+clear @user | +clear <amount>", desc: "Supprime messages: @ -> tout (≤300), nombre ≤300 (Owner/WL/Admin)", access: "admin" },
    { cmd: "+slowmode <s>", desc: "Définit slowmode (Owner/WL/Admin)", access: "admin" },
    { cmd: "+serverpic", desc: "Affiche icône serveur (Owner/WL/Admin)", access: "admin" },
    { cmd: "+serverbanner", desc: "Affiche bannière serveur (Owner/WL/Admin)", access: "admin" }
  ]},
  { category: "DOG", lines: [
    { cmd: "+dog @user", desc: "Verrouille pseudo + met laisse (Owner/WL/Admin) - ULTRA LOCK", access: "admin" },
    { cmd: "+undog @user", desc: "Libère un dog (exécutant/Owner/Admin)", access: "admin" },
    { cmd: "+undogall", desc: "Libère tous les dogs (Owner/WL/Admin)", access: "admin" },
    { cmd: "+doglist", desc: "Liste dogs (Owner/WL/Admin)", access: "admin" }
  ]},
  { category: "MOVE / PERM / WAKEUP", lines: [
    { cmd: "+mv @user", desc: "Déplace en vocal (perm_mv/Owner/WL/Admin)", access: "perm_mv" },
    { cmd: "+permv @user", desc: "Donne droit +mv (Owner/WL/Admin)", access: "admin" },
    { cmd: "+unpermv @user", desc: "Retire droit +mv (Owner/WL/Admin)", access: "admin" },
    { cmd: "+permvlist", desc: "Liste autorisés +mv (Owner/WL/Admin)", access: "admin" },
    { cmd: "+wakeup @user <times>", desc: "Déplace plusieurs fois + DM (Owner/WL/Admin)", access: "admin" }
  ]},
  { category: "SNIPE / SNAP", lines: [
    { cmd: "+snipe", desc: "Affiche dernier message supprimé (all)", access: "all" },
    { cmd: "+snap @user", desc: "Envoie 5 DM (Owner/WL/Admin)", access: "admin" }
  ]},
  { category: "LISTES / MODÉRATION", lines: [
    { cmd: "+wl @user / +unwl / +wlist", desc: "Whitelist (Owner only)", access: "owner" },
    { cmd: "+bl @user / +unbl / +blist", desc: "Blacklist & kick (Owner/WL/Admin)", access: "admin" },
    { cmd: "+ban / +unban / +banlist", desc: "Bannir / débannir (Owner/WL/Admin)", access: "admin" },
    { cmd: "+unbanall", desc: "Débannir tous (Owner/WL)", access: "owner_wl" },
    { cmd: "+wet / +unwet / +wetlist", desc: "Wet = ban spécial (Owner/WL)", access: "wl" }
  ]},
  { category: "TEXT LOCK", lines: [
    { cmd: "+lock", desc: "Verrouille salon texte (Owner/WL/Admin)", access: "owner_wl_admin" },
    { cmd: "+unlock", desc: "Déverrouille salon texte (Owner/WL/Admin)", access: "owner_wl_admin" }
  ]},
  { category: "VOICE PRIVATE (PV)", lines: [
    { cmd: "+pv", desc: "Toggle privé/public du vocal où tu es (Owner/WL/Admin)", access: "owner_wl_admin" },
    { cmd: "+pvacces @/ID", desc: "Donne accès au vocal privé (Owner/WL/Admin)", access: "owner_wl_admin" },
    { cmd: "+delacces @/ID", desc: "Retire accès au vocal privé (Owner/WL/Admin)", access: "owner_wl_admin" },
    { cmd: "+accesall", desc: "Donne accès à tous dans la voc (Owner/WL/Admin)", access: "owner_wl_admin" },
    { cmd: "+unpvall", desc: "Rend publics tous les vocaux rendus pv (Owner/WL/Admin)", access: "owner_wl_admin" },
    { cmd: "+pvlist", desc: "Liste vocaux privés gérés (Owner/WL/Admin)", access: "owner_wl_admin" }
  ]},
  { category: "BACKUP", lines: [
    { cmd: "+backup save", desc: "Sauvegarde serveur -> data/backups/<guildId>-<ts>.json (Owner/WL/Admin)", access: "admin" },
    { cmd: "+backup load", desc: "HARD restore: wipe + recreate (Owner/WL/Admin) - DESTRUCTIF", access: "admin" }
  ]}
];

// helper to check access
function hasAccess(member, accessKey) {
  if (!member) return false;
  const uid = member.id;
  switch (accessKey) {
    case "all": return true;
    case "owner": return isOwner(uid);
    case "wl": return isWL(uid);
    case "admin": return isAdminMember(member) || isWL(uid) || isOwner(uid);
    case "owner_admin_wl": return isOwner(uid) || isAdminMember(member) || isWL(uid);
    case "perm_mv": return isOwner(uid) || isAdminMember(member) || isWL(uid) || client.permMvUsers.has(uid);
    case "owner_wl": return isOwner(uid) || isWL(uid);
    case "owner_wl_admin": return isOwner(uid) || isWL(uid) || isAdminMember(member);
    default: return false;
  }
}

// -------------------- ANTI-SPAM TRACKER --------------------
const spamWindowMs = 5000;
const spamLimit = 5;
const userSpamState = new Map();

function recordMessageForSpam(userId) {
  const now = Date.now();
  const s = userSpamState.get(userId) || { count: 0, lastTs: 0 };
  if (now - s.lastTs <= spamWindowMs) {
    s.count = s.count + 1;
  } else {
    s.count = 1;
  }
  s.lastTs = now;
  userSpamState.set(userId, s);
  return s.count >= spamLimit;
}

// -------------------- BACKUP HELPERS (SAVE / HARD LOAD) --------------------
function backupFilePathForGuild(guildId) {
  const backupsDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  return path.join(backupsDir, `${guildId}-${ts}.json`);
}

async function backupSave(guild, authorId) {
  // Build backup object
  const roles = guild.roles.cache
    .sort((a,b) => a.position - b.position)
    .filter(r => r.id !== guild.roles.everyone.id)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.hexColor || r.color,
      hoist: r.hoist || false,
      position: r.position,
      permissions: r.permissions.bitfield,
      mentionable: r.mentionable || false,
      managed: r.managed || false
    }));

  const channels = [];
  guild.channels.cache
    .sort((a,b) => (a.position - b.position) || (a.id.localeCompare(b.id)))
    .forEach(ch => {
      channels.push({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        parentName: ch.parent ? ch.parent.name : null,
        topic: ch.topic || null,
        nsfw: ch.nsfw || false,
        bitrate: ch.bitrate || null,
        userLimit: ch.userLimit || null,
        position: ch.position,
        permissionOverwrites: ch.permissionOverwrites.cache.map(po => ({
          id: po.id,
          type: po.type,
          allow: po.allow.bitfield,
          deny: po.deny.bitfield
        }))
      });
    });

  const emojis = guild.emojis.cache.map(e => ({ id: e.id, name: e.name, url: e.url, animated: e.animated }));
  const stickers = guild.stickers.cache.map(s => ({ id: s.id, name: s.name, tags: s.tags, description: s.description || null }));
  let bans = [];
  try {
    const banCollection = await guild.bans.fetch().catch(()=>null);
    if (banCollection) bans = banCollection.map(b => ({ id: b.user.id, tag: b.user.tag, reason: b.reason || null }));
  } catch (e) {}

  // soundboards and other private data may be missing; best-effort

  const obj = {
    meta: { savedAt: Date.now(), savedBy: authorId, guildName: guild.name, guildId: guild.id },
    guild: { name: guild.name, iconURL: guild.iconURL ? guild.iconURL({ format: 'png', size: 1024 }) : null },
    roles, channels, emojis, stickers, bans
  };

  const filePath = backupFilePathForGuild(guild.id);
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
  return filePath;
}

async function backupLoadHard(guild, filePath, author) {
  // DESTRUCTIVE: remove channels (except maybe system channel?), remove roles (best-effort), remove emojis & stickers, then recreate from file
  if (!fs.existsSync(filePath)) throw new Error("Backup file missing.");
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  // Wipe process (best-effort)
  // 1) Remove channels
  try {
    // Fetch guild fresh
    await guild.roles.fetch().catch(()=>{});
    await guild.channels.fetch().catch(()=>{});
  } catch {}

  // Delete channels (except very protected system ones like rules? there's no hard protection)
  for (const ch of guild.channels.cache.values()) {
    try {
      await ch.delete(`Restore HARD by ${author.tag}`).catch(()=>{});
    } catch (e) {}
  }

  // Delete emojis
  for (const e of guild.emojis.cache.values()) {
    try { await guild.emojis.delete(e.id, `Restore HARD by ${author.tag}`).catch(()=>{}); } catch (e) {}
  }

  // Delete stickers
  try {
    for (const s of guild.stickers.cache.values()) {
      try { await guild.stickers.delete(s.id, `Restore HARD by ${author.tag}`).catch(()=>{}); } catch (e) {}
    }
  } catch (e) {}

  // Delete roles except @everyone and roles that have Administrator or owned by integrations (managed)
  // We need to be careful not to remove roles higher than bot
  const meRolePos = guild.members.me.roles.highest.position;
  const rolesToDelete = guild.roles.cache.filter(r => r.id !== guild.roles.everyone.id && !r.managed && meRolePos > r.position);
  for (const r of rolesToDelete.values()) {
    try { await r.delete(`Restore HARD by ${author.tag}`).catch(()=>{}); } catch (e) {}
  }

  // Now reconstruct from backup: roles -> categories -> channels -> overwrites -> emojis -> stickers -> bans
  const roleMap = new Map(); // oldRoleId -> newRoleId

  // Create roles from backup (skip managed). Recreate in same order.
  for (const r of data.roles || []) {
    try {
      if (r.managed) continue; // skip managed roles
      const created = await guild.roles.create({
        name: r.name,
        color: r.color || undefined,
        hoist: !!r.hoist,
        permissions: BigInt(r.permissions || 0),
        mentionable: !!r.mentionable,
        reason: `Restore HARD by ${author.tag}`
      }).catch(()=>null);
      if (created) roleMap.set(r.id, created.id);
    } catch (e) {
      console.error("role create error during restore:", e);
    }
  }

  // Attempt to set positions - best-effort
  try {
    const positions = [];
    guild.roles.cache.forEach(role => {
      const origId = [...roleMap.entries()].find(([k,v]) => v === role.id)?.[0] || null;
      if (origId) {
        const orig = (data.roles || []).find(rr => rr.id === origId);
        if (orig) positions.push({ id: role.id, position: orig.position });
      }
    });
    if (positions.length) await guild.roles.setPositions(positions).catch(()=>{});
  } catch (e) {}

  // Create categories first and map by name
  const categoryMap = new Map(); // originalParentName -> newCategoryId
  for (const c of (data.channels || []).filter(ch => ch.type === ChannelType.GuildCategory)) {
    try {
      const cat = await guild.channels.create({ name: c.name, type: ChannelType.GuildCategory, reason: `Restore category by ${author.tag}` }).catch(()=>null);
      if (cat) categoryMap.set(c.name, cat.id);
    } catch (e) { console.error("category create", e); }
  }

  // Create channels (text/voice)
  for (const ch of (data.channels || []).filter(ch => ch.type !== ChannelType.GuildCategory)) {
    try {
      const opts = { name: ch.name, type: ch.type, topic: ch.topic || undefined, reason: `Restore channel by ${author.tag}` };
      if (ch.parentName && categoryMap.has(ch.parentName)) opts.parent = categoryMap.get(ch.parentName);
      if (ch.type === ChannelType.GuildVoice) {
        if (ch.bitrate) opts.bitrate = ch.bitrate;
        if (ch.userLimit) opts.userLimit = ch.userLimit;
      }
      const created = await guild.channels.create(opts).catch(()=>null);
      if (!created) continue;
      // recreate permission overwrites
      for (const po of ch.permissionOverwrites || []) {
        const target = roleMap.get(po.id) || po.id;
        try {
          await created.permissionOverwrites.create(target, { allow: BigInt(po.allow || 0), deny: BigInt(po.deny || 0) }).catch(()=>{});
        } catch (e) {}
      }
    } catch (e) { console.error('channel create', e); }
  }

  // Emojis (best-effort) - try to create from URL
  for (const e of (data.emojis || [])) {
    try {
      if (!e.url) continue;
      await guild.emojis.create(e.url, e.name).catch(()=>{});
    } catch (err) { console.error('emoji create err', err); }
  }

  // Stickers (best-effort) - likely to fail if file not available
  for (const s of (data.stickers || [])) {
    try {
      // discord.js sticker creation requires a file/buffer. We can't fetch the original file reliably here.
      // Best-effort: skip or attempt if we had stored file. For now: no-op.
    } catch (err) { console.error('sticker create err', err); }
  }

  // Bans
  for (const b of (data.bans || [])) {
    try { await guild.members.ban(b.id, { reason: `Restore ban by ${author.tag}` }).catch(()=>{}); } catch {}
  }

  // Done
  return true;
}

// -------------------- COMMAND HANDLER --------------------
client.on('messageCreate', async message => {
  try {
    if (!message || !message.author || message.author.bot) return;

    if (client.processingMessageIds.has(message.id)) return;
    client.processingMessageIds.add(message.id);
    setTimeout(() => client.processingMessageIds.delete(message.id), 5000);

    const content = message.content || "";
    const authorId = message.author.id;

    const lastTs = client.messageLastTs.get(authorId) || 0;
    if (Date.now() - lastTs < shortCmdCooldownMs && !isOwner(authorId)) {
      return;
    }
    client.messageLastTs.set(authorId, Date.now());

    if (client.antispam && !isOwner(authorId)) {
      const isSpammer = recordMessageForSpam(authorId);
      if (isSpammer) {
        try { await message.delete().catch(()=>{}); } catch {}
        const warn = simpleEmbed("Spam détecté", `${message.author}, tu envoies trop de messages d'affilé — cesse s'il te plaît.`);
        const sent = await message.channel.send({ embeds: [warn] }).catch(()=>null);
        if (sent) setTimeout(() => sent.delete().catch(()=>{}), 2000);
        return;
      }
    }

    if (client.antlink && !isOwner(authorId) && /(discord\.gg|discordapp\.com\/invite|http:\/\/|https:\/\/)/i.test(content)) {
      await message.delete().catch(()=>{});
      const embed = simpleEmbed("Lien interdit", `${message.author}, les invitations / liens sont interdits ici.`);
      const sent = await message.channel.send({ embeds: [embed] }).catch(()=>null);
      if (sent) setTimeout(() => sent.delete().catch(()=>{}), 3000);
      return;
    }

    if (!content.startsWith('+')) return;
    const args = content.slice(1).trim().split(/ +/).filter(Boolean);
    if (args.length === 0) return;
    const command = (args.shift() || "").toLowerCase();

    // ---------- PING ----------
    if (command === 'ping') return message.channel.send("ta cru j'étais off btrd?").catch(()=>{});

    // ---------- HELP ----------
    if (command === 'help') {
      const embed = new EmbedBuilder().setTitle("Liste des commandes").setColor(MAIN_COLOR);
      for (const group of COMMANDS_DESC) {
        const lines = [];
        for (const l of group.lines) {
          if ((l.cmd === '+fabulous' || l.cmd === '+unfabulous' || l.cmd === '+fabulouslist' || l.cmd === '+dmall') && !isOwner(message.author.id)) continue;
          lines.push(`\`${l.cmd}\` — ${l.desc}`);
        }
        embed.addFields({ name: group.category, value: lines.join('\n'), inline: false });
      }
      embed.setFooter({ text: `Owner bot : ${OWNER_ID}` });
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }

    // ---------- PIC / BANNER ----------
    if (command === 'pic') {
      if (!message.guild) return message.reply("Commande utilisable uniquement en serveur.");
      let targetUser = message.mentions.users.first() || null;
      if (!targetUser && args[0]) {
        const maybe = args[0].replace(/[<@!>]/g,'');
        if (/^\d{17,19}$/.test(maybe)) {
          targetUser = await client.users.fetch(maybe).catch(()=>null);
        }
      }
      if (!targetUser) targetUser = message.author;
      const member = message.guild.members.cache.get(targetUser.id);
      const embed = new EmbedBuilder()
        .setTitle(`Photo de profil de ${member ? member.displayName : targetUser.tag}`)
        .setImage(targetUser.displayAvatarURL({ dynamic: true, size: 1024 }))
        .setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }
    if (command === 'banner') {
      if (!message.guild) return message.reply("Commande utilisable uniquement en serveur.");
      let u = message.mentions.users.first() || null;
      if (!u && args[0]) {
        const maybe = args[0].replace(/[<@!>]/g,'');
        if (/^\d{17,19}$/.test(maybe)) {
          u = await client.users.fetch(maybe).catch(()=>null);
        }
      }
      if (!u) u = message.author;
      try {
        const fetched = await client.users.fetch(u.id, { force: true });
        const bannerUrl = fetched.bannerURL?.({ size: 1024 });
        if (!bannerUrl) return message.reply("Ce membre n'a pas de bannière !");
        const embed = new EmbedBuilder().setTitle(`Bannière de ${u.tag}`).setImage(bannerUrl).setColor(MAIN_COLOR);
        return message.channel.send({ embeds: [embed] }).catch(()=>{});
      } catch (e) {
        return message.reply("Erreur lors de la récupération de la bannière.");
      }
    }

    // ---------- SERVER PIC / BANNER ----------
    if (command === 'serverpic') {
      if (!message.guild) return message.reply("Commande utilisable uniquement en serveur.");
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      const icon = message.guild.iconURL({ dynamic: true, size: 1024 });
      if (!icon) return message.reply("Ce serveur n'a pas d'icône !");
      const embed = new EmbedBuilder().setTitle(`${message.guild.name} - icône`).setImage(icon).setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }
    if (command === 'serverbanner') {
      if (!message.guild) return message.reply("Commande utilisable uniquement en serveur.");
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      const banner = message.guild.bannerURL?.({ size: 1024 });
      if (!banner) return message.reply("Ce serveur n'a pas de bannière !");
      const embed = new EmbedBuilder().setTitle(`${message.guild.name} - bannière`).setImage(banner).setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }

    // ---------- SAY (parody) ----------
    if (command === 'say') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande utilisable uniquement en serveur.");
      const targetMention = args[0];
      if (!targetMention) return message.reply("Usage: +say @cible <message>");
      let targetMember = message.mentions.members.first() || null;
      if (!targetMember) {
        const possibleId = targetMention.replace(/[<@!>]/g,'');
        if (/^\d{17,19}$/.test(possibleId)) {
          targetMember = await message.guild.members.fetch(possibleId).catch(()=>null);
        }
      }
      if (!targetMember) return message.reply("Cible introuvable (mentionne-la ou donne son ID).");
      const sayText = args.slice(1).join(' ').trim();
      if (!sayText) return message.reply("Fournis un message à envoyer.");
      try {
        const webhookName = `${targetMember.displayName} ◈`;
        const avatarUrl = targetMember.user.displayAvatarURL({ extension: 'png', size: 1024 });
        const chan = message.channel;
        const webhook = await chan.createWebhook({ name: webhookName, avatar: avatarUrl, reason: `+say parodie (◈) par ${message.author.tag}` }).catch(()=>null);
        if (!webhook) {
          return message.reply("Impossible de créer un webhook ici (vérifie mes permissions).");
        }
        const contentToSend = `◈ [envoyé par ${message.author.tag}] ${sayText}`;
        await webhook.send({
          content: contentToSend,
          username: webhookName,
          avatarURL: avatarUrl,
          allowedMentions: { parse: [] }
        }).catch(()=>{});
        try { await webhook.delete(`Cleanup after +say (◈) by ${message.author.tag}`); } catch(e){}
        return message.channel.send({ embeds: [simpleEmbed("✓ +say (◈)", `Message envoyé en tant que *${targetMember.displayName} ◈* — marqué comme parodie.`)] }).then(m => setTimeout(()=>m.delete().catch(()=>{}), 4000)).catch(()=>{});
      } catch (err) {
        console.error("Erreur +say:", err);
        return message.reply("Erreur lors de l'exécution de +say.");
      }
    }

    // ---------- ROLE MANAGEMENT ----------
    if (command === 'addrole') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      const roleArg = args[0] || args[1];
      const role = message.mentions.roles.first() || parseRoleArg(message.guild, roleArg) || message.guild.roles.cache.get(roleArg);
      if (!member || !role) return message.reply("Usage: +addrole @user <roleID>");
      const limit = client.limitRoles.get(role.id);
      if (limit && role.members.size >= limit) return message.reply(`Le rôle ${role.name} a atteint sa limite (${limit}).`);
      await member.roles.add(role).catch(()=>message.reply("Impossible d'ajouter le rôle (vérifie mes permissions)."));
      try {
        const logs = await ensureLogChannels(message.guild);
        const ch = logs.roles;
        if (ch) {
          const embed = new EmbedBuilder()
            .setTitle("Rôle ajouté (via +addrole)")
            .addFields(
              { name: "Membre", value: `${member.user.tag} (${member.id})`, inline: true },
              { name: "Rôle", value: `${role.name} (${role.id})`, inline: true },
              { name: "Exécutant", value: `${message.author.tag}`, inline: true }
            ).setColor(MAIN_COLOR).setTimestamp();
          ch.send({ embeds: [embed] }).catch(()=>{});
        }
      } catch {}
      return message.channel.send(`✓ ${member.user.tag} a reçu le rôle ${role.name}`);
    }
    if (command === 'delrole') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      const roleArg = args[0] || args[1];
      const role = message.mentions.roles.first() || parseRoleArg(message.guild, roleArg) || message.guild.roles.cache.get(roleArg);
      if (!member || !role) return message.reply("Usage: +delrole @user <roleID>");
      await member.roles.remove(role).catch(()=>message.reply("Impossible de retirer le rôle (vérifie mes permissions)."));
      try {
        const logs = await ensureLogChannels(message.guild);
        const ch = logs.roles;
        if (ch) {
          const embed = new EmbedBuilder()
            .setTitle("Rôle retiré (via +delrole)")
            .addFields(
              { name: "Membre", value: `${member.user.tag} (${member.id})`, inline: true },
              { name: "Rôle", value: `${role.name} (${role.id})`, inline: true },
              { name: "Exécutant", value: `${message.author.tag}`, inline: true }
            ).setColor(MAIN_COLOR).setTimestamp();
          ch.send({ embeds: [embed] }).catch(()=>{});
        }
      } catch {}
      return message.channel.send(`✓ ${member.user.tag} a perdu le rôle ${role.name}`);
    }
    if (command === 'derank') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      await member.roles.set([]).catch(()=>message.reply("Impossible de modifier les rôles."));
      return message.channel.send(`✓ ${member.user.tag} a été déranké !`);
    }

    // ---------- LIMIT ROLE ----------
    if (command === 'limitrole') {
      if (!isWL(message.author.id) && !isOwner(message.author.id)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const role = message.mentions.roles.first() || parseRoleArg(message.guild, args[0]);
      const max = parseInt(args[1] || args[0]);
      if (!role || isNaN(max) || max < 1) return message.reply("Usage: +limitrole @role <max>");
      client.limitRoles.set(role.id, max);
      persistAll();
      return message.channel.send(`✓ Limite du rôle ${role.name} définie à ${max} membres !`);
    }
    if (command === 'unlimitrole' || command === 'unlimiterole') {
      if (!isWL(message.author.id) && !isOwner(message.author.id)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const role = message.mentions.roles.first() || parseRoleArg(message.guild, args[0]);
      if (!role) return message.reply("Usage: +unlimitrole @role");
      client.limitRoles.delete(role.id);
      persistAll();
      return message.channel.send(`✓ Limite du rôle ${role.name} supprimée !`);
    }

    // ---------- ANT TOGGLES ----------
    if (['antibot','antispam','antlink','antiraid','raidlog'].includes(command)) {
      if (command === 'antiraid' && !isOwner(message.author.id)) return sendNoAccess(message);
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      client[command] = !client[command];
      return message.channel.send(`✓ ${command} ${client[command] ? "activé" : "désactivé"} !`);
    }

    // ---------- SLOWMODE ----------
    if (command === 'slowmode') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const seconds = parseInt(args[0]);
      if (isNaN(seconds) || seconds < 0 || seconds > 21600) return message.reply("Donne un nombre entre 0 et 21600 (secondes).");
      message.channel.setRateLimitPerUser(seconds).then(() => {
        message.channel.send(`✓ Slowmode défini à ${seconds}s pour ce salon.`).then(m => setTimeout(() => m.delete().catch(()=>{}), 5000));
      }).catch(() => message.reply("Impossible de modifier le slowmode (vérifie mes permissions)."));
      return;
    }

    // ---------- SNIPE ----------
    if (command === 'snipe') {
      const snipe = client.snipes.get(message.channel.id);
      if (!snipe) return message.reply("Aucun message à snipe !");
      const date = new Date(snipe.timestamp || Date.now());
      const embed = new EmbedBuilder()
        .setAuthor({ name: snipe.author.tag, iconURL: snipe.author.displayAvatarURL?.({ dynamic: true }) })
        .setDescription(snipe.content)
        .addFields({ name: "Supprimé le", value: `${date.toLocaleString()}`, inline: true })
        .setColor(MAIN_COLOR);
      const sent = await message.channel.send({ embeds: [embed] }).catch(()=>null);
      if (sent) setTimeout(() => sent.delete().catch(()=>{}), 30000);
      return;
    }

    // ---------- CLEAR ----------
    if (command === 'clear') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      if (!message.channel) return;
      const possibleMention = message.mentions.users.first();
      if (possibleMention) {
        const numArg = args.find(a => /^\d+$/.test(a));
        const toDeleteLimit = Math.min(300, Math.max(1, numArg ? parseInt(numArg) : 300));
        try {
          let fetchedAll = [];
          let lastId = null;
          while (fetchedAll.length < toDeleteLimit) {
            const fetchLimit = Math.min(100, toDeleteLimit - fetchedAll.length);
            const fetched = await message.channel.messages.fetch({ limit: fetchLimit, before: lastId || undefined });
            if (!fetched || fetched.size === 0) break;
            fetchedAll = fetchedAll.concat(Array.from(fetched.values()));
            lastId = fetchedAll[fetchedAll.length - 1].id;
            if (fetched.size < fetchLimit) break;
          }
          const toDelete = fetchedAll.filter(m => m.author.id === possibleMention.id).slice(0, toDeleteLimit);
          if (toDelete.length === 0) return message.reply("Aucun message trouvé de cet utilisateur dans ce salon (récents).");
          while (toDelete.length) {
            const chunk = toDelete.splice(0, 100);
            await message.channel.bulkDelete(chunk.map(m => m.id), true).catch(()=>{});
            await new Promise(res => setTimeout(res, 500));
          }
          const info = await message.channel.send({ embeds: [simpleEmbed("Messages supprimés", `✓ ${toDeleteLimit} messages (ou jusqu'à ${toDeleteLimit} trouvés) de ${possibleMention.tag} supprimés.`)] }).catch(()=>null);
          if (info) setTimeout(() => info.delete().catch(()=>{}), 3000);
        } catch (err) {
          console.error("clear @user error:", err);
          return message.reply("Erreur lors de la suppression des messages de la cible.");
        }
        return;
      } else {
        const num = parseInt(args[0]) || 1;
        const toDel = Math.min(300, Math.max(1, num));
        try {
          let remaining = toDel;
          let beforeId = undefined;
          while (remaining > 0) {
            const fetchLimit = Math.min(100, remaining);
            const f = await message.channel.messages.fetch({ limit: fetchLimit, before: beforeId });
            if (!f || f.size === 0) break;
            await message.channel.bulkDelete(f, true).catch(()=>{});
            remaining -= f.size;
            beforeId = f.size > 0 ? f.last().id : undefined;
            await new Promise(res => setTimeout(res, 300));
          }
          const info = await message.channel.send({ embeds: [simpleEmbed("Messages supprimés", `✓ ${toDel} messages supprimés (max 300).`)] }).catch(()=>null);
          if (info) setTimeout(() => info.delete().catch(()=>{}), 3000);
        } catch (err) {
          console.error("clear number error:", err);
          return message.reply("Erreur lors de la suppression des messages.");
        }
        return;
      }
    }

    // ---------- DOG SYSTEM (ULTRA-LOCK) ----------
   if (command === "dog") {
    if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId))
        return sendNoAccess(message);

    const member = message.mentions.members.first();
    if (!member) return message.reply("Mentionne quelqu’un !");
    if (member.id === message.author.id) return message.reply("Tu ne peux pas te dog toi-même !");
    if (client.dogs.has(member.id)) return message.reply("Déjà dog.");

    const lockedName = `( 🦮 ${message.member.displayName} )`;

    client.dogs.set(member.id, {
        executorId: message.author.id,
        lockedName
    });

    client.lockedNames.add(member.id);
    persistAll();

    member.setNickname(lockedName).catch(() => {});
    if (member.voice.channel && message.member.voice.channel)
        member.voice.setChannel(message.member.voice.channel).catch(() => {});

    return message.channel.send(`${member} a été mis en laisse 🦮`);
}
    }
    if (command === 'undog') {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      if (!client.dogs.has(member.id)) return message.reply("Ce membre n'est pas en laisse !");
      const info = client.dogs.get(member.id);
      if (info.executorId !== message.author.id && !isAdminMember(message.member) && !isOwner(authorId)) return message.reply("Tu n'es pas le maître de ce dog !");
      client.dogs.delete(member.id);
      client.lockedNames.delete(member.id);
      persistAll();
      try {
        if (info.originalNick) await member.setNickname(info.originalNick).catch(()=>{});
        else await member.setNickname(null).catch(()=>{});
      } catch (e) {}
      return message.channel.send(`✓ ${member.displayName} a été libéré par ${message.member.displayName} !`);
    }
    if (command === 'undogall') {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      client.dogs.forEach((info, dogId) => {
        const dog = message.guild.members.cache.get(dogId);
        if (dog) {
          try {
            if (info.originalNick) dog.setNickname(info.originalNick).catch(()=>{});
            else dog.setNickname(null).catch(()=>{});
          } catch {}
          client.lockedNames.delete(dogId);
        }
      });
      client.dogs.clear();
      persistAll();
      return message.channel.send("✓ Tous les dogs ont été libérés !");
    }
    if (command === 'doglist') {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      if (client.dogs.size === 0) return message.reply("Aucun dog enregistré !");
      const list = [...client.dogs.entries()].map(([dogId, info]) => {
        const dog = message.guild.members.cache.get(dogId);
        const executor = message.guild.members.cache.get(info.executorId);
        return `${dog ? dog.displayName : dogId} -> ${executor ? executor.displayName : info.executorId} (locked: "${info.lockedName}")`;
      }).join("\n");
      return message.channel.send(`Liste des dogs :\n${list}`);
    }

    // ---------- MV / PERMV ----------
    if (command === 'mv') {
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const target = message.mentions.members.first() || (args[0] && message.guild.members.cache.get(args[0]));
      if (!target) return message.reply("Membre introuvable !");
      if (!target.voice.channel) return message.reply("Cet utilisateur n'est pas en vocal !");
      if (!message.member.voice.channel) return message.reply("Tu dois être en vocal !");
      if (!hasAccess(message.member, "perm_mv")) return sendNoAccess(message);
      await target.voice.setChannel(message.member.voice.channel).catch(()=>{});
      return message.channel.send(`✓ ${target.displayName} déplacé dans ton channel vocal !`);
    }
    if (command === 'permv') {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.permMvUsers.add(member.id);
      persistAll();
      return message.channel.send(`✓ ${member.displayName} peut désormais utiliser +mv !`);
    }
    if (command === 'unpermv') {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.permMvUsers.delete(member.id);
      persistAll();
      return message.channel.send(`✓ ${member.displayName} ne peut plus utiliser +mv !`);
    }
    if (['permvlist','permmvlist','permmv'].includes(command)) {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      if (client.permMvUsers.size === 0) return message.reply("Aucun membre autorisé à +mv !");
      const list = [...client.permMvUsers].map(id => {
        const m = message.guild.members.cache.get(id);
        return m ? m.displayName : id;
      }).join("\n");
      return message.channel.send(`Membres autorisés à +mv :\n${list}`);
    }

    // ---------- WAKEUP ----------
    if (command === 'wakeup') {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const target = message.mentions.members.first() || (args[0] && message.guild.members.cache.get(args[0]));
      let times = parseInt(args[1] || args[0 + 1]) || 0;
      if (!target) return message.reply("Mentionnez un membre !");
      if (!target.voice.channel) return message.reply("Cet utilisateur n'est pas en vocal !");
      if (!times || times < 1 || times > 150) return message.reply("Donne un nombre de réveils entre 1 et 150 !");
      const executorId = message.author.id;
      if (!isOwner(executorId) && isOnPersistentCooldown('wakeup', executorId)) {
        const until = persistentCooldowns['wakeup'][executorId];
        const remain = Math.ceil((until - Date.now()) / 1000);
        return message.reply(`⏳ Attends ${remain} secondes avant de refaire +wakeup !`);
      }
      if (!client._wakeupInProgress) client._wakeupInProgress = new Set();
      if (client._wakeupInProgress.has(target.id)) return message.reply("Un wakeup est déjà en cours pour cette cible.");
      client._wakeupInProgress.add(target.id);
      if (!isOwner(executorId)) setPersistentCooldown('wakeup', executorId, 5 * 60 * 1000);
      const voiceChannels = message.guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice && c.viewable).map(c => c);
      if (voiceChannels.length < 1) {
        client._wakeupInProgress.delete(target.id);
        return message.reply("Aucun channel vocal disponible pour faire le wakeup.");
      }
      const delayMs = 600;
      let moved = 0;
      try {
        for (let i = 0; i < times; i++) {
          const ch = voiceChannels[i % voiceChannels.length];
          try { await target.voice.setChannel(ch).catch(()=>{}); } catch (e) {}
          moved++;
          await new Promise(res => setTimeout(res, delayMs));
        }
      } catch (err) {
        console.error("wakeup moves error:", err);
      } finally {
        client._wakeupInProgress.delete(target.id);
      }
      const dmMessage = `<@${executorId}> t'ordonne de te réveiller !`;
      (async () => {
        for (let i = 0; i < times; i++) {
          try { await target.send(dmMessage).catch(()=>{}); } catch {}
          await new Promise(res => setTimeout(res, 500));
        }
      })();
      try {
        const logs = await ensureLogChannels(message.guild);
        const cmdCh = logs.commands;
        const embed = new EmbedBuilder()
          .setTitle("Wakeup exécuté")
          .setDescription(`Le wakeup de **${target.user.tag}** a été effectué.`)
          .addFields(
            { name: "Cible", value: `${target.user.tag}`, inline: true },
            { name: "Exécutant", value: `${message.author.tag}`, inline: true },
            { name: "Times demandés", value: `${times}`, inline: true }
          )
          .setColor(MAIN_COLOR).setTimestamp();
        if (cmdCh) {
          await cmdCh.send({ embeds: [embed] }).catch(()=>{});
        }
      } catch (e) {}
      if (message.channel && message.channel.name !== 'commande-logs') {
        await message.channel.send(`${target.displayName} se fait réveiller`).catch(()=>{});
      }
      return message.channel.send(`✓ ${target.displayName} a été réveillé ${moved} fois (max demandé ${times}). DM(s) envoyé(s).`);
    }

    // ---------- SNAP ----------
    if (command === 'snap') {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande utilisable uniquement en serveur.");
      const target = message.mentions.members.first();
      if (!target) return message.reply("Mentionnez un membre !");
      const executorId = message.author.id;
      if (!isOwner(executorId) && isOnPersistentCooldown('snap', executorId)) {
        const until = persistentCooldowns['snap'][executorId];
        const remain = Math.ceil((until - Date.now()) / 1000);
        return message.reply(`⏳ Attends ${remain} secondes avant de refaire +snap !`);
      }
      for (let i = 0; i < 5; i++) {
        try { await target.send(`<@${executorId}> te demande ton snap !`).catch(()=>{}); } catch {}
        await new Promise(res => setTimeout(res, 300));
      }
      if (!isOwner(executorId)) setPersistentCooldown('snap', executorId, 5 * 60 * 1000);
      try {
        const logs = await ensureLogChannels(message.guild);
        const cmdCh = logs.commands;
        const embed = new EmbedBuilder()
          .setTitle("Snap demandé")
          .setDescription(`Le snap de **${target.user.tag}** a été demandé (DM envoyé).`)
          .addFields(
            { name: "Cible", value: `${target.user.tag}`, inline: true },
            { name: "Exécutant", value: `${message.author.tag}`, inline: true }
          )
          .setColor(MAIN_COLOR)
          .setTimestamp();
        if (cmdCh) {
          await cmdCh.send({ embeds: [embed] }).catch(()=>{});
        }
      } catch (e) {}
      if (message.channel && message.channel.name !== 'commande-logs') {
        await message.channel.send(`Le snap de ${target} a bien été demandé`).catch(()=>{});
      }
      return;
    }

    // ---------- SPAM MP (DM) ----------
    if (command === 'spammp') {
      if (!(isOwner(authorId) || isWL(authorId) || isAdminMember(message.member))) return sendNoAccess(message);
      if (!args[0]) return message.reply("Usage: +spamMp @user <message> <count> (max 150).");
      let targetUser = message.mentions.users.first() || null;
      if (!targetUser) {
        const maybeId = args[0].replace(/[<@!>]/g,'');
        if (/^\d{17,19}$/.test(maybeId)) {
          targetUser = await client.users.fetch(maybeId).catch(()=>null);
        }
      }
      if (!targetUser) return message.reply("Utilisateur introuvable (mentionne ou fournis un ID valide).");
      const last = args[args.length - 1];
      const count = parseInt(last);
      if (isNaN(count)) return message.reply("Donne un nombre de répétitions valide à la fin (ex: 10).");
      if (count < 1 || count > 150) return message.reply("Le nombre doit être entre 1 et 150.");
      const msgParts = args.slice(1, args.length - 1);
      const dmText = msgParts.join(' ').trim();
      if (!dmText) return message.reply("Tu dois fournir un message à envoyer.");
      if (!isOwner(authorId) && isAdminMember(message.member) && !isWL(authorId)) {
        if (targetUser.id === OWNER_ID) return message.reply("Tu ne peux pas toucher l'owner du bot.");
        if (client.whitelist.has(targetUser.id)) return message.reply("Tu ne peux pas toucher un WL.");
      }
      if (!isOwner(authorId) && !isWL(authorId) && isAdminMember(message.member)) {
        if (isOnPersistentCooldown('spamMp', authorId)) {
          const until = persistentCooldowns['spamMp'][authorId];
          const remain = Math.ceil((until - Date.now()) / 1000);
          return message.reply(`⏳ Admin en cooldown pour +spamMp, attends ${remain} secondes.`);
        }
      }
      const ack = await message.channel.send(`${message.author}, envoi de ${count} MP(s) vers <@${targetUser.id}> en cours...`).catch(()=>null);
      let sent = 0;
      try {
        for (let i = 0; i < count; i++) {
          try { await targetUser.send(dmText).catch(()=>{}); sent++; } catch (e) {}
          await new Promise(res => setTimeout(res, 500));
        }
      } catch (e) { console.error("spamMp loop error:", e); }
      if (!isOwner(authorId) && !isWL(authorId) && isAdminMember(message.member)) {
        setPersistentCooldown('spamMp', authorId, 5 * 60 * 1000);
      }
      try {
        if (ack) await ack.edit(`${message.author}, opération terminée — ${sent}/${count} MP(s) envoyés à <@${targetUser.id}>.`).catch(()=>{});
        else await message.channel.send(`${message.author}, opération terminée — ${sent}/${count} MP(s) envoyés à <@${targetUser.id}>.`).catch(()=>{});
      } catch {}
      return;
    }

    // ---------- WL / UNWL / WLIST ----------
    if (command === 'wl') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.whitelist.add(member.id);
      persistAll();
      return message.channel.send(`✓ ${member.user.tag} ajouté à la whitelist !`);
    }
    if (command === 'unwl') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.whitelist.delete(member.id);
      persistAll();
      return message.channel.send(`✓ ${member.user.tag} retiré de la whitelist !`);
    }
    if (command === 'wlist') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      if (client.whitelist.size === 0) return message.reply("La whitelist est vide !");
      const mentions = [...client.whitelist].map(id => `<@${id}>`).join('\n');
      return message.channel.send(`Membres whitelist :\n${mentions}`);
    }

    // ---------- BLACKLIST (+bl kick) ----------
    if (command === 'bl') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      if (member.id === OWNER_ID || client.whitelist.has(member.id)) return message.reply("Impossible d'ajouter ce membre à la blacklist (protection owner / whitelist).");
      client.blacklist.add(member.id);
      persistAll();
      try { await member.kick("Blacklist ajouté via +bl"); } catch {}
      return message.channel.send(`✓ ${member.user.tag} ajouté à la blacklist et kick !`);
    }
    if (command === 'unbl') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      let member = message.mentions.members.first();
      if (!member && args[0] && /^\d{17,19}$/.test(args[0])) {
        const id = args[0];
        member = { id };
      }
      if (!member) return message.reply("Mentionnez un membre ou fournis un ID !");
      client.blacklist.delete(member.id);
      persistAll();
      return message.channel.send(`✓ ${member.id ? `<@${member.id}>` : member.user.tag} retiré de la blacklist !`);
    }
    if (command === 'blist') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      if (client.blacklist.size === 0) return message.reply("La blacklist est vide !");
      const list = [...client.blacklist].map(id => {
        const m = message.guild?.members.cache.get(id);
        return m ? m.user.tag : id;
      }).join("\n");
      return message.channel.send(`Membres blacklist :\n${list}`);
    }

    // ---------- BAN / UNBAN ----------
    if (command === 'ban') {
      if (!(isOwner(authorId) || isWL(authorId) || isAdminMember(message.member))) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      if (member.id === OWNER_ID || client.whitelist.has(member.id)) return message.reply("Impossible de bannir ce membre (protection owner / whitelist).");
      client.banList.add(member.id);
      persistAll();
      await member.ban({ reason: "Ban command" }).catch(()=>{});
      return message.channel.send(`✓ ${member.user.tag} a été banni !`);
    }
    if (command === 'unban') {
      if (!(isOwner(authorId) || isWL(authorId) || isAdminMember(message.member))) return sendNoAccess(message);
      let user = message.mentions.users.first();
      if (!user && args[0] && /^\d{17,19}$/.test(args[0])) {
        const id = args[0];
        user = await client.users.fetch(id).catch(()=>null);
      }
      if (!user) return message.reply("Mentionnez un utilisateur ou fournis un ID !");
      client.banList.delete(user.id);
      persistAll();
      message.guild.members.unban(user.id).catch(()=>{});
      return message.channel.send(`✓ ${user.tag} a été débanni !`);
    }
    if (command === 'banlist') {
      if (!(isOwner(authorId) || isWL(authorId) || isAdminMember(message.member))) return sendNoAccess(message);
      if (client.banList.size === 0) return message.reply("Aucun membre banni !");
      const list = [...client.banList].map(id => {
        const u = client.users.cache.get(id);
        return u ? u.tag : id;
      }).join("\n");
      return message.channel.send(`Liste des bannis :\n${list}`);
    }
    if (command === 'unbanall') {
      if (!isOwner(authorId) && !isWL(authorId)) return sendNoAccess(message);
      for (const id of [...client.banList]) {
        try { await message.guild.members.unban(id); } catch {}
        client.banList.delete(id);
      }
      persistAll();
      return message.channel.send("✓ Tentative de débannir tous les membres de la banList.");
    }

    // ---------- WET ----------
    if (command === 'wet') {
      if (!(isOwner(authorId) || isWL(authorId))) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      if (member.id === OWNER_ID || client.whitelist.has(member.id)) return message.reply("Impossible de wet ce membre (protection owner / whitelist).");
      if (client.wetList.has(member.id)) return message.reply("Ce membre est déjà wet !");
      client.wetList.add(member.id);
      persistAll();
      await member.ban({ reason: "Wet ban" }).catch(()=>{});
      return message.channel.send(`☠️ ${member.user.tag} a été wet (banni) !`);
    }
    if (command === 'unwet') {
      if (!(isOwner(authorId) || isWL(authorId))) return sendNoAccess(message);
      let user = message.mentions.users.first();
      if (!user && args[0] && /^\d{17,19}$/.test(args[0])) {
        const id = args[0];
        user = await client.users.fetch(id).catch(()=>null);
      }
      if (!user) return message.reply("Mentionnez un utilisateur ou fournis un ID !");
      if (!client.wetList.has(user.id)) return message.reply("Ce membre n'a pas été wet !");
      client.wetList.delete(user.id);
      persistAll();
      message.guild.members.unban(user.id).catch(()=>{});
      return message.channel.send(`✓ ${user.tag} a été dé-wet !`);
    }
    if (command === 'wetlist') {
      if (!(isOwner(authorId) || isWL(authorId))) return sendNoAccess(message);
      if (client.wetList.size === 0) return message.reply("Aucun membre wet !");
      const list = [...client.wetList].map(id => {
        const u = client.users.cache.get(id);
        return u ? u.tag : id;
      }).join("\n");
      return message.channel.send(`Membres wet :\n${list}`);
    }

    // ---------- LOCKNAME ----------
    if (command === 'lockname') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.lockedNames.add(member.id);
      persistAll();
      return message.channel.send(`🔒 Le pseudo de ${member.displayName} est maintenant verrouillé !`);
    }
    if (command === 'unlockname') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.lockedNames.delete(member.id);
      persistAll();
      return message.channel.send(`🔓 Le pseudo de ${member.displayName} est maintenant déverrouillé !`);
    }
    if (command === 'locknamelist') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      if (client.lockedNames.size === 0) return message.reply("Aucun pseudo n'est verrouillé !");
      const list = [...client.lockedNames].map(id => {
        const m = message.guild.members.cache.get(id);
        return m ? m.displayName : id;
      }).join("\n");
      return message.channel.send(`Pseudos verrouillés :\n${list}`);
    }

    // ---------- ADMIN CUSTOM (+admin, +unadmin, +adminlist) ----------
    if (command === 'admin') {
      if (!ownerOrWLOnly(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.adminUsers.add(member.id);
      persistAll();
      return message.channel.send(`✓ ${member.user.tag} a reçu la permission admin (via +admin).`);
    }
    if (command === 'unadmin' || command === 'deladmin') {
      if (!ownerOrWLOnly(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.adminUsers.delete(member.id);
      persistAll();
      return message.channel.send(`✓ ${member.user.tag} a perdu la permission admin (via +unadmin).`);
    }
    if (command === 'adminlist') {
      if (!ownerOrWLOnly(message.author.id)) return sendNoAccess(message);
      const customAdmins = [...client.adminUsers].map(id => {
        if (!message.guild) return id;
        const m = message.guild.members.cache.get(id);
        return m ? `${m.user.tag} (${m.id})` : id;
      });
      const roleAdmins = message.guild ? message.guild.members.cache.filter(m => m.permissions.has(PermissionsBitField.Flags.Administrator)).map(m => `${m.user.tag} (${m.id})`) : [];
      const embed = new EmbedBuilder()
        .setTitle("Liste des admins")
        .addFields(
          { name: "Admins via +admin", value: customAdmins.length ? customAdmins.join("\n") : "Aucun", inline: false },
          { name: "Admins via rôle (permissions Administrator)", value: roleAdmins.length ? roleAdmins.join("\n") : "Aucun", inline: false }
        )
        .setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }

    // ---------- TEXT LOCK / UNLOCK ----------
    if (command === 'lock') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      if (message.channel.type !== ChannelType.GuildText) return message.reply("Commande à effectuer dans un salon texte.");
      const ok = await setTextLock(message.channel, true);
      if (ok) return message.channel.send("🔒 Salon verrouillé (seuls Owner/WL/Admin peuvent écrire).").catch(()=>{});
      return message.reply("Erreur lors du verrouillage du salon.");
    }
    if (command === 'unlock') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      if (message.channel.type !== ChannelType.GuildText) return message.reply("Commande à effectuer dans un salon texte.");
      const ok = await setTextLock(message.channel, false);
      if (ok) return message.channel.send("🔓 Salon déverrouillé.").catch(()=>{});
      return message.reply("Erreur lors du déverrouillage du salon.");
    }

    // ---------- VOICE PRIVATIZATION (PV) ----------
    if (command === 'pv') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      const vc = message.member.voice.channel;
      if (!vc) return message.reply("Tu dois être en vocal pour utiliser +pv ici.");
      const pv = client.pvChannels.get(vc.id);
      if (pv) {
        const ok = await makeVoicePublic(vc);
        if (ok) return message.channel.send(`✓ Ce vocal (${vc.name}) est redevenu public.`).catch(()=>{});
        return message.reply("Erreur lors du passage en public.");
      } else {
        const ok = await makeVoicePrivate(vc, message.member);
        if (ok) return message.channel.send(`🔒 Ce vocal (${vc.name}) est maintenant privé. Les membres présents ont l'accès.`).catch(()=>{});
        return message.reply("Erreur lors du passage en privé.");
      }
    }

    if (command === 'pvacces') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      const vc = message.member.voice.channel;
      if (!vc) return message.reply("Tu dois être en vocal pour utiliser +pvacces ici.");
      const pv = client.pvChannels.get(vc.id);
      if (!pv) return message.reply("Ce vocal n'est pas en mode privé (+pv).");
      const target = message.mentions.users.first() || (args[0] && { id: args[0] });
      if (!target) return message.reply("Mentionne ou fournis l'ID de l'utilisateur à autoriser.");
      const uid = (target.id) ? target.id : args[0];
      const ok = await addVoiceAccess(vc, uid);
      if (ok) return message.channel.send(`✓ <@${uid}> a maintenant accès au vocal privé ${vc.name}.`).catch(()=>{});
      return message.reply("Erreur lors de l'ajout d'accès.");
    }

    if (command === 'delacces') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      const vc = message.member.voice.channel;
      if (!vc) return message.reply("Tu dois être en vocal pour utiliser +delacces ici.");
      const pv = client.pvChannels.get(vc.id);
      if (!pv) return message.reply("Ce vocal n'est pas en mode privé (+pv).");
      const target = message.mentions.users.first() || (args[0] && { id: args[0] });
      if (!target) return message.reply("Mentionne ou fournis l'ID de l'utilisateur à retirer.");
      const uid = (target.id) ? target.id : args[0];
      const ok = await delVoiceAccess(vc, uid);
      if (ok) return message.channel.send(`✓ <@${uid}> a perdu l'accès au vocal privé ${vc.name}.`).catch(()=>{});
      return message.reply("Erreur lors de la suppression d'accès.");
    }

    if (command === 'accesall') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      const vc = message.member.voice.channel;
      if (!vc) return message.reply("Tu dois être en vocal pour utiliser +accesall ici.");
      const ok = await grantAccessToAllInVoice(vc);
      if (ok) return message.channel.send(`✓ Tous les membres présents dans ${vc.name} ont maintenant l'accès.`).catch(()=>{});
      return message.reply("Erreur lors de l'ajout d'accès à tous.");
    }

    if (command === 'unpvall') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      let count = 0;
      for (const [id] of client.pvChannels) {
        const ch = message.guild.channels.cache.get(id);
        if (!ch) {
          client.pvChannels.delete(id);
          continue;
        }
        const ok = await makeVoicePublic(ch);
        if (ok) count++;
      }
      return message.channel.send(`✓ ${count} vocaux rendus publics.`).catch(()=>{});
    }

    if (command === 'pvlist') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      if (client.pvChannels.size === 0) return message.reply("Aucun vocal privé géré par le bot.");
      const list = [...client.pvChannels.entries()].map(([id, info]) => {
        const ch = message.guild.channels.cache.get(id);
        const name = ch ? ch.name : id;
        const allowed = [...info.allowed].map(x => `<@${x}>`).join(", ") || "Aucun";
        return `${name} -> ${allowed}`;
      }).join("\n\n");
      return message.channel.send(`Vocaux privés gérés :\n${list}`).catch(()=>{});
    }

    // ---------- DMALL (OWNER-ONLY) ----------
    if (command === 'dmall') {
      if (!isOwner(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande utilisable uniquement en serveur.");
      const dmText = args.join(' ').trim();
      if (!dmText) return message.reply("Usage : +dmall <message à envoyer à tous les membres (non-bot)>");
      try {
        const ownerUser = await client.users.fetch(OWNER_ID).catch(()=>null);
        if (ownerUser) {
          await ownerUser.send(`+dmall : opération lancée sur le serveur **${message.guild.name}** (${message.guild.id}). Envoi en cours...`).catch(()=>{});
        }
      } catch (e) {}
      let members = [];
      try {
        const fetched = await message.guild.members.fetch().catch(()=>null);
        if (fetched) {
          members = fetched.filter(m => !m.user.bot).map(m => m.user);
        }
      } catch (e) { members = []; }
      let sentCount = 0;
      let failCount = 0;
      for (const u of members) {
        try {
          await u.send(dmText).catch(()=>{ throw new Error("send failed"); });
          sentCount++;
        } catch (e) {
          failCount++;
        }
        await new Promise(res => setTimeout(res, 1000));
      }
      try {
        const ownerUser = await client.users.fetch(OWNER_ID).catch(()=>null);
        if (ownerUser) {
          await ownerUser.send(`+dmall terminé sur **${message.guild.name}**. Envoyés : ${sentCount}. Échoués : ${failCount}.`).catch(()=>{});
        }
      } catch (e) {}
      return message.channel.send(`✓ +dmall terminé. Envoyés : ${sentCount}. Échoués : ${failCount}. (Owner notifié en MP)`).catch(()=>{});
    }

    // ---------- BACKUP (save / load HARD) ----------
   if (sub === 'save') {
    const guild = message.guild;

    const roles = guild.roles.cache
        .sort((a, b) => a.position - b.position)
        .map(r => ({
            id: r.id,
            name: r.name,
            color: r.hexColor,
            hoist: r.hoist,
            position: r.position,
            permissions: Number(r.permissions.bitfield), // FIX
            mentionable: r.mentionable
        }));

    const channels = guild.channels.cache
        .sort((a, b) => a.position - b.position)
        .map(ch => ({
            id: ch.id,
            name: ch.name,
            type: ch.type,
            parentName: ch.parent?.name || null,
            topic: ch.topic || null,
            nsfw: ch.nsfw || false,
            bitrate: ch.bitrate || null,
            userLimit: ch.userLimit || null,
            position: ch.position,
            permissionOverwrites: ch.permissionOverwrites.cache.map(po => ({
                id: po.id,
                type: po.type,
                allow: Number(po.allow.bitfield), // FIX
                deny: Number(po.deny.bitfield)     // FIX
            }))
        }));

    const obj = {
        meta: { savedAt: Date.now(), savedBy: message.author.id },
        guild: {
            name: guild.name,
            iconURL: guild.iconURL({ extension: 'png', size: 1024 })
        },
        roles,
        channels
    };

    try {
        fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
        return message.channel.send("✅ Backup sauvegardé !");
    } catch (e) {
        console.error(e);
        return message.reply("Erreur lors de la sauvegarde.");
    }
}

else if (sub === "load" || sub === "restore") {

    if (!fs.existsSync(filePath))
        return message.reply("Aucun backup trouvé pour ce serveur.");

    let data;
    try {
        data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return message.reply("Le backup est corrompu.");
    }

    const roleMap = new Map();

    for (const r of data.roles) {
        if (r.name === "@everyone") {
            roleMap.set(r.id, message.guild.roles.everyone.id);
            continue;
        }

        try {
            const created = await message.guild.roles.create({
                name: r.name,
                color: r.color,
                hoist: r.hoist,
                permissions: BigInt(r.permissions), // FIX OK
                mentionable: r.mentionable,
                reason: `Restore by ${message.author.tag}`
            });

            roleMap.set(r.id, created.id);
        } catch {
            roleMap.set(r.id, null);
        }
    }

    const categoryMap = new Map();
    for (const c of data.channels.filter(ch => ch.type === 4)) {
        const cat = await message.guild.channels.create({
            name: c.name,
            type: 4
        }).catch(() => null);

        if (cat) categoryMap.set(c.name, cat.id);
    }

    for (const ch of data.channels.filter(ch => ch.type !== 4)) {
        const opts = {
            name: ch.name,
            type: ch.type,
            topic: ch.topic || undefined
        };

        if (ch.parentName && categoryMap.has(ch.parentName))
            opts.parent = categoryMap.get(ch.parentName);

        const created = await message.guild.channels.create(opts).catch(() => null);
        if (!created) continue;

        for (const po of ch.permissionOverwrites) {
            const target = roleMap.get(po.id) || po.id;
            created.permissionOverwrites.create(target, {
                allow: BigInt(po.allow),
                deny: BigInt(po.deny)
            }).catch(() => {});
        }
    }

    return message.channel.send("✅ Backup restauré !");
}

// -------------------- READY --------------------
client.once('ready', () => {
  console.log(`✓ Connecté en tant que ${client.user.tag}`);
  try { client.user.setActivity("+help", { type: "LISTENING" }).catch(()=>{}); } catch {}
  client.guilds.cache.forEach(async g => {
    try { await ensureLogChannels(g); } catch (e) {}
  });
});

// --------------------Graceful shutdown--------------------
process.on('SIGINT', () => { console.log("SIGINT reçu, sauvegarde..."); persistAll(); process.exit(); });
process.on('beforeExit', () => { persistAll(); });

// -------------------- LOGIN --------------------
const token = process.env.TOKEN || process.env.TOKEN_DISCORD || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
if (!token) {
  console.error("Aucun token trouvé. Ajoute ton token dans .env sous TOKEN= ou BOT_TOKEN=");
  process.exit(1);
}
client.login(token).then(() => console.log("Bot login success.")).catch(err => console.error("Erreur de connexion :", err));
