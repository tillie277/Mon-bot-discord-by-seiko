// index.js - version finale unifiée (prête à coller dans index.js)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');

// -------------------- CONFIG --------------------
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "726063885492158474"; // Owner fixe
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
  cooldowns: path.join(DATA_DIR, 'cooldowns.json')
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
client.dogs = new Map(); // targetId -> { executorId, lockedName }
client.permMvUsers = new Set();
client.limitRoles = new Map();
client.lockedNames = new Set();

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
}
function loadAll() {
  const wl = readJSONSafe(PATHS.whitelist); if (Array.isArray(wl)) wl.forEach(id => client.whitelist.add(id));
  const adm = readJSONSafe(PATHS.admin); if (Array.isArray(adm)) adm.forEach(id => client.adminUsers.add(id));
  const bl = readJSONSafe(PATHS.blacklist); if (Array.isArray(bl)) bl.forEach(id => client.blacklist.add(id));
  const wet = readJSONSafe(PATHS.wetList); if (Array.isArray(wet)) wet.forEach(id => client.wetList.add(id));
  const ban = readJSONSafe(PATHS.banList); if (Array.isArray(ban)) ban.forEach(id => client.banList.add(id));
  const dogs = readJSONSafe(PATHS.dogs); if (Array.isArray(dogs)) dogs.forEach(([k,v]) => client.dogs.set(k,v));
  const pmv = readJSONSafe(PATHS.permMv); if (Array.isArray(pmv)) pmv.forEach(id => client.permMvUsers.add(id));
  const lr = readJSONSafe(PATHS.limitRoles); if (Array.isArray(lr)) lr.forEach(([k,v]) => client.limitRoles.set(k,v));
  const ln = readJSONSafe(PATHS.lockedNames); if (Array.isArray(ln)) ln.forEach(id => client.lockedNames.add(id));
  const cds = readJSONSafe(PATHS.cooldowns); if (cds && typeof cds === 'object') persistentCooldowns = cds;
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
client.on('messageDelete', message => {
  if (!message || !message.author || message.author.bot) return;
  if (message.channel) client.snipes.set(message.channel.id, { content: message.content || "", author: message.author, timestamp: Date.now() });
});

client.on('guildMemberAdd', async member => {
  try {
    // blacklist: kick after 3s if rejoin
    if (client.blacklist.has(member.id)) {
      setTimeout(async () => {
        try { await member.kick("Membre blacklisté (auto kick on join)"); } catch {}
      }, 3000);
      return;
    }
    if (client.antibot && member.user.bot) {
      await member.kick("Anti-bot activé").catch(()=>{});
      return;
    }
    // other antiraid logic unchanged from prior implementation
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

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    // enforce locked names from lockedNames set AND dogs map lockedName
    if (client.lockedNames && client.lockedNames.has(newMember.id)) {
      if (oldMember?.nickname !== newMember?.nickname) {
        await newMember.setNickname(oldMember?.nickname || newMember.user.username).catch(()=>{});
      }
    }
    if (client.dogs && client.dogs.has(newMember.id)) {
      const info = client.dogs.get(newMember.id);
      if (info && info.lockedName && newMember.displayName !== info.lockedName) {
        await newMember.setNickname(info.lockedName).catch(()=>{});
      }
    }
  } catch (e) { console.error("guildMemberUpdate error:", e); }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  try {
    if (!newState || !newState.guild) return;
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
  // format: {category, lines: [{cmd, desc, access}]}
  {
    category: "GENERAL",
    lines: [
      { cmd: "+help", desc: "Affiche toutes les commandes selon tes accès", access: "admin/wl/owner" },
      { cmd: "+ping", desc: "Répond 'ta cru j’étais mort btrd?'", access: "all" }
    ]
  },
  {
    category: "ROLES",
    lines: [
      { cmd: "+pic @user | +pic", desc: "Affiche la photo de profil", access: "all" },
      { cmd: "+banner @user | +banner", desc: "Affiche la bannière d'un utilisateur", access: "all" },
      { cmd: "+addrole @user roleID | +delrole @user roleID", desc: "Ajoute/retire un rôle", access: "admin/wl/owner" },
      { cmd: "+derank @user", desc: "Retire tous les rôles d'un membre", access: "admin/wl/owner" }
    ]
  },
  {
    category: "LIMIT ROLES",
    lines: [
      { cmd: "+limitrole @role <max> | +unlimitrole @role", desc: "Définit / supprime une limite de rôle", access: "wl/owner" }
    ]
  },
  {
    category: "ANTIS",
    lines: [
      { cmd: "+antispam", desc: "Active/désactive l'antispam (avertit après 5 messages d'affilé)", access: "admin/wl/owner" },
      { cmd: "+antibot", desc: "Toggle anti-bot (kick bots à l'arrivée)", access: "admin/wl/owner" },
      { cmd: "+antlink", desc: "Toggle anti-invitation", access: "admin/wl/owner" },
      { cmd: "+antiraid", desc: "Toggle anti-raid (owner only)", access: "owner" },
      { cmd: "+raidlog", desc: "Toggle envoi du log anti-raid (admin/wl/owner)", access: "admin/wl/owner" }
    ]
  },
  {
    category: "MISC",
    lines: [
      { cmd: "+clear @user <amount> | +clear <amount>", desc: "Supprime messages (admin/wl/owner)", access: "admin/wl/owner" },
      { cmd: "+slowmode <seconds>", desc: "Définit le slowmode du salon", access: "admin/wl/owner" },
      { cmd: "+serverpic", desc: "Affiche l'icône du serveur", access: "admin/wl/owner" },
      { cmd: "+serverbanner", desc: "Affiche la bannière du serveur", access: "admin/wl/owner" }
    ]
  },
  {
    category: "DOG SYSTEM",
    lines: [
      { cmd: "+dog @user | +undog @user | +undogall | +doglist", desc: "Mets en laisse / libère / liste (owner/admin/wl)", access: "admin/wl/owner" }
    ]
  },
  {
    category: "MOVE / PERM / WAKEUP",
    lines: [
      { cmd: "+mv @user | +mv userID", desc: "Déplacer un membre vers ton vocal (permMv/autorisés)", access: "perm_mv/admin/wl/owner" },
      { cmd: "+permv @user | +unpermv @user | +permvlist", desc: "Donne/retrait perm +mv / liste (admin/wl/owner)", access: "admin/wl/owner" },
      { cmd: "+wakeup @user <times>", desc: "Déplace la cible <times> fois + DM (owner/admin/wl) - cooldown 5min", access: "owner/admin/wl" }
    ]
  },
  {
    category: "SNIPE / SNAP",
    lines: [
      { cmd: "+snipe", desc: "Montre dernier message supprimé (auto-supprimé 3s)", access: "all" },
      { cmd: "+snap @user", desc: "Envoie 5 DMs demandant le snap (owner/admin/wl) - cooldown 5min", access: "owner/admin/wl" }
    ]
  },
  {
    category: "LISTES / MODÉRATION",
    lines: [
      { cmd: "+wl @user | +unwl @user | +wlist", desc: "Gère whitelist (owner pour add/rem)", access: "owner/wl/admin" },
      { cmd: "+bl @user | +unbl @user | +blist", desc: "Gère blacklist (+bl kick automatiquement)", access: "admin/wl/owner" },
      { cmd: "+ban @user | +unban @user | +banlist | +unbanall", desc: "Bannir / débannir (admin/wl/owner)", access: "admin/wl/owner" },
      { cmd: "+wet @user | +unwet @user | +wetlist", desc: "Wet = banList spéciale (owner/wl)", access: "owner/wl" }
    ]
  }
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
    default: return false;
  }
}

// -------------------- ANTI-SPAM TRACKER --------------------
// We track count and last timestamp; if 5 messages within rolling window (e.g. each subsequent within 5s of previous) => warn
const spamWindowMs = 5000;
const spamLimit = 5;
const userSpamState = new Map(); // userId -> { count, lastTs }

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

// -------------------- COMMAND HANDLER --------------------
client.on('messageCreate', async message => {
  try {
    if (!message || !message.author || message.author.bot) return;

    // prevent duplicate processing of same message.id
    if (client.processingMessageIds.has(message.id)) return;
    client.processingMessageIds.add(message.id);
    setTimeout(() => client.processingMessageIds.delete(message.id), 5000);

    const content = message.content || "";
    const authorId = message.author.id;

    // short anti-double-command per user
    const lastTs = client.messageLastTs.get(authorId) || 0;
    if (Date.now() - lastTs < shortCmdCooldownMs && !isOwner(authorId)) {
      return; // ignore duplicate/fast repeated events
    }
    client.messageLastTs.set(authorId, Date.now());

    // anti-spam toggle: when enabled, after 5 messages in sequence within window, warn and auto-delete the warning after 2s
    if (client.antispam && !isOwner(authorId)) {
      const isSpammer = recordMessageForSpam(authorId);
      if (isSpammer) {
        try {
          await message.delete().catch(()=>{});
        } catch {}
        const warn = simpleEmbed("Spam détecté", `${message.author}, tu envoies trop de messages d'affilé — cesse s'il te plaît.`);
        const sent = await message.channel.send({ embeds: [warn] }).catch(()=>null);
        if (sent) setTimeout(() => sent.delete().catch(()=>{}), 2000);
        return;
      }
    }

    // anti-link
    if (client.antlink && !isOwner(authorId) && /(discord\.gg|discordapp\.com\/invite|http:\/\/|https:\/\/)/i.test(content)) {
      await message.delete().catch(()=>{});
      const embed = simpleEmbed("Lien interdit", `${message.author}, les invitations / liens sont interdits ici.`);
      const sent = await message.channel.send({ embeds: [embed] }).catch(()=>null);
      if (sent) setTimeout(() => sent.delete().catch(()=>{}), 3000);
      return;
    }

    // store snipe
    if (message.channel) client.snipes.set(message.channel.id, { content: content || "", author: message.author, timestamp: Date.now() });

    if (!content.startsWith('+')) return;
    const args = content.slice(1).trim().split(/ +/).filter(Boolean);
    if (args.length === 0) return;
    const command = (args.shift() || "").toLowerCase();

    // ---------- PING ----------
    if (command === 'ping') {
      return message.channel.send("ta cru j’étais mort btrd?").catch(()=>{});
    }

    // ---------- HELP ----------
    if (command === 'help') {
      // show help to anyone but filter displayed commands based on access (you wanted admin/wl/owner see different)
      const embed = new EmbedBuilder().setTitle("Liste des commandes").setColor(MAIN_COLOR);
      for (const group of COMMANDS_DESC) {
        const lines = [];
        for (const l of group.lines) {
          // decide whether to show based on access requirement: we'll show all but mark access
          lines.push(`\`${l.cmd}\` — ${l.desc} (${l.access})`);
        }
        embed.addFields({ name: group.category, value: lines.join('\n'), inline: false });
      }
      embed.setFooter({ text: `Owner bot : ${OWNER_ID}` });
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }

    // ---------- PIC / BANNER ----------
    if (command === 'pic') {
      if (!message.guild) return message.reply("Commande utilisable uniquement en serveur.");
      const userMember = message.mentions.members.first() || message.member;
      const embed = new EmbedBuilder()
        .setTitle(`Photo de profil de ${userMember.displayName}`)
        .setImage(userMember.user.displayAvatarURL({ dynamic: true, size: 1024 }))
        .setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }
    if (command === 'banner') {
      if (!message.guild) return message.reply("Commande utilisable uniquement en serveur.");
      const u = message.mentions.users.first() || message.author;
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
    if ((command === 'serverpic' || command === 'serverbanner') && !message.guild) return message.reply("Commande utilisable uniquement en serveur.");
    if (command === 'serverpic') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      const icon = message.guild.iconURL({ dynamic: true, size: 1024 });
      const embed = new EmbedBuilder().setTitle(`${message.guild.name} - icône`).setImage(icon).setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }
    if (command === 'serverbanner') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      const banner = message.guild.bannerURL?.({ size: 1024 });
      if (!banner) return message.reply("Ce serveur n'a pas de bannière !");
      const embed = new EmbedBuilder().setTitle(`${message.guild.name} - bannière`).setImage(banner).setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
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
      return message.channel.send(`✅ ${member.user.tag} a reçu le rôle ${role.name}`);
    }
    if (command === 'delrole') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      const roleArg = args[0] || args[1];
      const role = message.mentions.roles.first() || parseRoleArg(message.guild, roleArg) || message.guild.roles.cache.get(roleArg);
      if (!member || !role) return message.reply("Usage: +delrole @user <roleID>");
      await member.roles.remove(role).catch(()=>message.reply("Impossible de retirer le rôle (vérifie mes permissions)."));
      return message.channel.send(`✅ ${member.user.tag} a perdu le rôle ${role.name}`);
    }
    if (command === 'derank') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      await member.roles.set([]).catch(()=>message.reply("Impossible de modifier les rôles."));
      return message.channel.send(`✅ ${member.user.tag} a été déranké !`);
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
      return message.channel.send(`✅ Limite du rôle ${role.name} définie à ${max} membres !`);
    }
    if (command === 'unlimitrole' || command === 'unlimiterole') {
      if (!isWL(message.author.id) && !isOwner(message.author.id)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const role = message.mentions.roles.first() || parseRoleArg(message.guild, args[0]);
      if (!role) return message.reply("Usage: +unlimitrole @role");
      client.limitRoles.delete(role.id);
      persistAll();
      return message.channel.send(`✅ Limite du rôle ${role.name} supprimée !`);
    }

    // ---------- ANT TOGGLES ----------
    if (['antibot','antispam','antlink','antiraid','raidlog'].includes(command)) {
      if (command === 'antiraid' && !isOwner(message.author.id)) return sendNoAccess(message);
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      client[command] = !client[command];
      return message.channel.send(`✅ ${command} ${client[command] ? "activé" : "désactivé"} !`);
    }

    // ---------- SLOWMODE ----------
    if (command === 'slowmode') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const seconds = parseInt(args[0]);
      if (isNaN(seconds) || seconds < 0 || seconds > 21600) return message.reply("Donne un nombre entre 0 et 21600 (secondes).");
      message.channel.setRateLimitPerUser(seconds).then(() => {
        message.channel.send(`✅ Slowmode défini à ${seconds}s pour ce salon.`).then(m => setTimeout(() => m.delete().catch(()=>{}), 5000));
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
      if (sent) setTimeout(() => sent.delete().catch(()=>{}), 3000);
      return;
    }

    // ---------- CLEAR ----------
    if (command === 'clear') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      if (!message.channel) return;
      const possibleId = args[0];
      let target = message.mentions.users.first();
      let amount = 0;
      if (target) {
        amount = parseInt(args[1]) || parseInt(args[0]) || 50;
      } else {
        if (possibleId && /^\d{17,19}$/.test(possibleId)) {
          target = await client.users.fetch(possibleId).catch(()=>null);
          amount = parseInt(args[1]) || 50;
        } else {
          amount = parseInt(args[0]) || 50;
        }
      }
      if (amount < 1 || amount > 100) return message.reply("Donne un nombre entre 1 et 100 !");
      try {
        const fetched = await message.channel.messages.fetch({ limit: 100 });
        let messagesToDelete;
        if (target) {
          messagesToDelete = fetched.filter(m => m.author.id === target.id).first(amount);
        } else {
          messagesToDelete = fetched.first(amount);
        }
        await message.channel.bulkDelete(messagesToDelete, true).catch(()=>{});
        const info = await message.channel.send({ embeds: [simpleEmbed("Messages supprimés", `${target ? `${amount} messages de ${target.tag} supprimés` : `${amount} messages supprimés`}`)] });
        setTimeout(() => info.delete().catch(()=>{}), 2000);
      } catch (err) {
        console.error("clear error:", err);
        message.channel.send("Une erreur est survenue lors de la suppression des messages.");
      }
      return;
    }

    // ---------- DOG SYSTEM ----------
    // Access: owner/admin/wl (as requested)
    if (command === 'dog') {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      if (member.id === message.author.id) return message.reply("Tu ne peux pas te mettre toi-même en dog !");
      if (client.dogs.has(member.id)) return message.reply("Ce membre est déjà en laisse !");
      // lock name: DisplayName ( 🦮 ExecutorDisplayName )
      const executorDisplay = message.member.displayName.replace(/\)/g,'').replace(/\(/g,'');
      const lockedName = `${member.displayName} ( 🦮 ${executorDisplay} )`;
      client.dogs.set(member.id, { executorId: message.author.id, lockedName });
      client.lockedNames.add(member.id);
      persistAll();
      try { await member.setNickname(lockedName).catch(()=>{}); } catch {}
      try { if (member.voice.channel && message.member.voice.channel) await member.voice.setChannel(message.member.voice.channel).catch(()=>{}); } catch {}
      return message.channel.send(`✅ ${member.displayName} est maintenant en laisse par ${message.member.displayName} (nom verrouillé).`);
    }
    if (command === 'undog') {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      if (!client.dogs.has(member.id)) return message.reply("Ce membre n'est pas en laisse !");
      const info = client.dogs.get(member.id);
      // Only executor, admins or owner can undog
      if (info.executorId !== message.author.id && !isAdminMember(message.member) && !isOwner(authorId)) return message.reply("Tu n'es pas le maître de ce dog !");
      client.dogs.delete(member.id);
      client.lockedNames.delete(member.id);
      persistAll();
      await member.setNickname(null).catch(()=>{});
      return message.channel.send(`✅ ${member.displayName} a été libéré par ${message.member.displayName} !`);
    }
    if (command === 'undogall') {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      client.dogs.forEach((info, dogId) => {
        const dog = message.guild.members.cache.get(dogId);
        if (dog) dog.setNickname(null).catch(()=>{});
        client.lockedNames.delete(dogId);
      });
      client.dogs.clear();
      persistAll();
      return message.channel.send("✅ Tous les dogs ont été libérés !");
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
      return message.channel.send(`✅ ${target.displayName} déplacé dans ton channel vocal !`);
    }
    if (command === 'permv') {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.permMvUsers.add(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.displayName} peut désormais utiliser +mv !`);
    }
    if (command === 'unpermv') {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.permMvUsers.delete(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.displayName} ne peut plus utiliser +mv !`);
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
      // cooldown check (persisted). owner immune
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
      return message.channel.send(`✅ ${target.displayName} a été réveillé ${moved} fois (max demandé ${times}). DM(s) envoyé(s).`);
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
      const embed = new EmbedBuilder()
        .setTitle("Snap demandé")
        .setDescription(`Le snap de **${target.user.tag}** a été demandé (DM envoyé).`)
        .addFields(
          { name: "Cible", value: `${target.user.tag}`, inline: true },
          { name: "Exécutant", value: `${message.author.tag}`, inline: true }
        )
        .setColor(MAIN_COLOR)
        .setTimestamp();
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }

    // ---------- WL / UNWL / WLIST ----------
    if (command === 'wl') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.whitelist.add(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.user.tag} ajouté à la whitelist !`);
    }
    if (command === 'unwl') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.whitelist.delete(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.user.tag} retiré de la whitelist !`);
    }
    if (command === 'wlist') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
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
      // kick immediately
      try { await member.kick("Blacklist ajouté via +bl"); } catch {}
      return message.channel.send(`✅ ${member.user.tag} ajouté à la blacklist et kick !`);
    }
    if (command === 'unbl') {
      if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.blacklist.delete(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.user.tag} retiré de la blacklist !`);
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
      // +ban accessible owner, wl, admin
      if (!(isOwner(authorId) || isWL(authorId) || isAdminMember(message.member))) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      if (member.id === OWNER_ID || client.whitelist.has(member.id)) return message.reply("Impossible de bannir ce membre (protection owner / whitelist).");
      client.banList.add(member.id);
      persistAll();
      await member.ban({ reason: "Ban command" }).catch(()=>{});
      return message.channel.send(`✅ ${member.user.tag} a été banni !`);
    }
    if (command === 'unban') {
      if (!(isOwner(authorId) || isWL(authorId) || isAdminMember(message.member))) return sendNoAccess(message);
      const user = message.mentions.users.first();
      if (!user) return message.reply("Mentionnez un utilisateur !");
      client.banList.delete(user.id);
      persistAll();
      message.guild.members.unban(user.id).catch(()=>{});
      return message.channel.send(`✅ ${user.tag} a été débanni !`);
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
      if (!isOwner(authorId)) return sendNoAccess(message);
      for (const id of [...client.banList]) {
        try { await message.guild.members.unban(id); } catch {}
        client.banList.delete(id);
      }
      persistAll();
      return message.channel.send("✅ Tentative de débannir tous les membres de la banList.");
    }

    // ---------- WET ----------
    if (command === 'wet') {
      // wet accessible owner and wl
      if (!(isOwner(authorId) || isWL(authorId))) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      if (member.id === OWNER_ID || client.whitelist.has(member.id)) return message.reply("Impossible de wet ce membre (protection owner / whitelist).");
      if (client.wetList.has(member.id)) return message.reply("Ce membre est déjà wet !");
      client.wetList.add(member.id);
      persistAll();
      await member.ban({ reason: "Wet ban" }).catch(()=>{});
      return message.channel.send(`⚠️ ${member.user.tag} a été wet (banni) !`);
    }
    if (command === 'unwet') {
      if (!(isOwner(authorId) || isWL(authorId))) return sendNoAccess(message);
      const user = message.mentions.users.first();
      if (!user) return message.reply("Mentionnez un utilisateur !");
      if (!client.wetList.has(user.id)) return message.reply("Ce membre n'a pas été wet !");
      client.wetList.delete(user.id);
      persistAll();
      message.guild.members.unban(user.id).catch(()=>{});
      return message.channel.send(`✅ ${user.tag} a été dé-wet !`);
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
      return message.channel.send(`✅ ${member.user.tag} a reçu la permission admin (via +admin).`);
    }
    if (command === 'unadmin' || command === 'deladmin') {
      if (!ownerOrWLOnly(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.adminUsers.delete(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.user.tag} a perdu la permission admin (via +unadmin).`);
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

    // If no command matched, ignore (end)
    return;

  } catch (err) {
    console.error("Erreur gestion message:", err);
    try { await message.reply("Une erreur est survenue lors du traitement de la commande."); } catch {}
  }
});

// -------------------- READY --------------------
client.once('ready', () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  try { client.user.setActivity("+help", { type: "LISTENING" }).catch(()=>{}); } catch {}
});

// --------------------Graceful shutdown--------------------
process.on('SIGINT', () => { console.log("SIGINT reçu, sauvegarde..."); persistAll(); process.exit(); });
process.on('beforeExit', () => { persistAll(); });

// -------------------- LOGIN --------------------
const token = process.env.TOKEN || process.env.TOKEN_DISCORD || process.env.DISCORD_TOKEN;
if (!token) {
  console.error("Aucun token trouvé. Ajoute ton token dans .env sous TOKEN=");
  process.exit(1);
}
client.login(token).then(() => console.log("Bot login success.")).catch(err => console.error("Erreur de connexion :", err));
