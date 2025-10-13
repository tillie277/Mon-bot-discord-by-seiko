// index.js - version finale unifiée (prête à coller dans index.js)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');

// -------------------- CONFIG --------------------
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "726063885492158474"; // Owner fixe (remplace si besoin)
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
  lockedTextChannels: path.join(DATA_DIR, 'lockedTextChannels.json'),
  fabulous: path.join(DATA_DIR, 'fabulous.json'),
  logsChannels: path.join(DATA_DIR, 'logsChannels.json')
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
  ],
  partials: ['MESSAGE', 'CHANNEL', 'GUILD_MEMBER']
});

// -------------------- IN-MEMORY STORES --------------------
client.whitelist = new Set();
client.adminUsers = new Set();
client.blacklist = new Set();
client.wetList = new Set();
client.banList = new Set();
client.dogs = new Map(); // targetId -> { executorId, lockedName, createdAt }
client.permMvUsers = new Set();
client.limitRoles = new Map();
client.lockedNames = new Set();
client.pvChannels = new Map(); // channelId -> { allowed: Set, ownerId }
client.lockedTextChannels = new Set();
client.fabulous = new Set(); // owner-granted targets allowed to be touched

client.snipes = new Map(); // channelId -> {content, author, timestamp}
client.messageLastTs = new Map(); // per-user last message timestamp (short)
client.processingMessageIds = new Set(); // prevent duplicate processing per message.id

// persistent cooldowns (snap/wakeup/spamAdmin): { snap: { userId: expiryTs }, wakeup: {...}, spam_admin: {...} }
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

// persistent storage for logs channels per guild: { guildId: { messages: id, role: id, boost: id, commands: id, raid: id } }
let persistedLogsChannels = {};

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
  writeJSONSafe(PATHS.fabulous, [...client.fabulous]);
  writeJSONSafe(PATHS.logsChannels, persistedLogsChannels);
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
  const pv = readJSONSafe(PATHS.pv); if (pv && typeof pv === 'object') {
    Object.entries(pv).forEach(([k,v]) => {
      client.pvChannels.set(k, { allowed: new Set(Array.isArray(v.allowed) ? v.allowed : []), ownerId: v.ownerId || null });
    });
  }
  const lockedTxt = readJSONSafe(PATHS.lockedTextChannels); if (Array.isArray(lockedTxt)) lockedTxt.forEach(id => client.lockedTextChannels.add(id));
  const fab = readJSONSafe(PATHS.fabulous); if (Array.isArray(fab)) fab.forEach(id => client.fabulous.add(id));
  const logsC = readJSONSafe(PATHS.logsChannels); if (logsC && typeof logsC === 'object') persistedLogsChannels = logsC;
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
  const mention = mentionOrId.toString().match(/^<@!?(\d+)>$/);
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

// Hierarchy target check helper
function canTarget(callerMember, targetMember) {
  // returns { ok: boolean, reason: string|null }
  if (!callerMember || !targetMember) return { ok: false, reason: "Membre introuvable." };
  const callerId = callerMember.id;
  const targetId = targetMember.id;
  // owner cannot be banned/kicked/wet; nobody can touch owner except owner or with fabulous rules (special)
  if (targetId === OWNER_ID) {
    // allow owner to act on themselves; else require caller to be owner or to be on fabulous list permitting touching owner
    if (callerId === OWNER_ID) return { ok: true, reason: null };
    if (client.fabulous.has(callerId)) return { ok: true, reason: null };
    return { ok: false, reason: "Tu ne peux pas toucher l'owner." };
  }
  // if target is WL and caller is admin (but not WL/owner) -> disallow
  if (client.whitelist.has(targetId) && !isWL(callerId) && !isOwner(callerId)) {
    // caller is not WL nor owner; cannot touch
    return { ok: false, reason: "Tu ne peux toucher ton supérieur." };
  }
  // if target is WL and caller is WL? wl can affect admin but not owner; if both WL, allow
  // if caller is admin but target is WL -> disallow
  if (client.whitelist.has(targetId) && isAdminMember(callerMember) && !isWL(callerId) && !isOwner(callerId)) {
    return { ok: false, reason: "Tu ne peux toucher ton supérieur." };
  }
  // admin cannot touch WL or owner - covered; also admin cannot touch a WL even if target is admin? we covered WL specifically.
  return { ok: true, reason: null };
}

// Permission helper to set text lock
async function setTextLock(channel, lock) {
  try {
    const guild = channel.guild;
    if (!guild || channel.type !== ChannelType.GuildText) return false;
    // deny SEND_MESSAGES to @everyone when locking
    const everyone = guild.roles.everyone;
    if (lock) {
      await channel.permissionOverwrites.edit(everyone, { SendMessages: false }).catch(()=>{});
      // allow send to owner, whitelist and adminUsers explicitly
      const allowIds = new Set([OWNER_ID, ...client.whitelist, ...client.adminUsers]);
      // also allow server administrators (iterate members with admin perm)
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
      // unlock: restore @everyone send to null and remove explicit overwrites we added
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
    // build allowed list from current members
    const allowed = new Set([...voiceChannel.members.keys()]);
    // always include setter
    if (setterMember && setterMember.id) allowed.add(setterMember.id);
    // include owner/wl/admin
    allowed.add(OWNER_ID);
    client.whitelist.forEach(id => allowed.add(id));
    client.adminUsers.forEach(id => allowed.add(id));
    client.pvChannels.set(voiceChannel.id, { allowed, ownerId: setterMember ? setterMember.id : null });
    // deny CONNECT for everyone
    await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.roles.everyone, { Connect: false }).catch(()=>{});
    // allow CONNECT for allowed ids
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
    // restore everyone connect to null
    await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.roles.everyone, { Connect: null }).catch(()=>{});
    // remove explicit user overwrites that we created (best effort)
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

// create or fetch standard log channels for a guild; store IDs in persistedLogsChannels[guildId]
async function ensureLogChannelsForGuild(guild) {
  try {
    if (!guild) return;
    const key = guild.id;
    if (!persistedLogsChannels[key]) persistedLogsChannels[key] = {};
    const wanted = [
      { key: 'messages', name: 'messages-logs', desc: 'Logs des messages supprimés/édités' },
      { key: 'role', name: 'role-logs', desc: 'Logs des changements de rôles' },
      { key: 'boost', name: 'boost-logs', desc: 'Logs des boosts/unboosts' },
      { key: 'commands', name: 'command-logs', desc: 'Logs des commandes utilisées' },
      { key: 'raid', name: 'raid-logs', desc: 'Logs anti-raid' }
    ];
    for (const w of wanted) {
      const existingId = persistedLogsChannels[key] && persistedLogsChannels[key][w.key];
      let ch = existingId ? guild.channels.cache.get(existingId) : null;
      if (!ch) {
        // try to find by name
        ch = guild.channels.cache.find(c => c.name === w.name && c.type === ChannelType.GuildText);
      }
      if (!ch) {
        // create if possible
        try {
          ch = await guild.channels.create({ name: w.name, type: ChannelType.GuildText, reason: 'Création salons logs par bot' });
        } catch (e) {
          // cannot create -> skip
          continue;
        }
      }
      persistedLogsChannels[key][w.key] = ch.id;
    }
    persistAll();
  } catch (e) { console.error("ensureLogChannelsForGuild error", e); }
}

// helper to send to a log channel if exists
async function sendToLog(guild, type, embed) {
  try {
    if (!guild) return;
    const cfg = persistedLogsChannels[guild.id];
    if (!cfg || !cfg[type]) return;
    const ch = guild.channels.cache.get(cfg[type]);
    if (!ch) return;
    ch.send({ embeds: [embed] }).catch(()=>{});
  } catch (e) { console.error("sendToLog error", e); }
}

// sleep helper
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
client.on('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  try { client.user.setActivity("+help", { type: "LISTENING" }).catch(()=>{}); } catch {}
  // ensure log channels for all guilds where bot is present
  for (const [id, guild] of client.guilds.cache) {
    await ensureLogChannelsForGuild(guild).catch(()=>{});
  }
});

// message deleted -> snipe + log
client.on('messageDelete', async message => {
  try {
    if (!message || !message.author || message.author.bot) return;
    if (message.channel) client.snipes.set(message.channel.id, { content: message.content || "", author: message.author, timestamp: Date.now() });
    // send embed to message-logs
    const embed = new EmbedBuilder()
      .setTitle("Message supprimé")
      .addFields(
        { name: "Auteur", value: `${message.author.tag} (${message.author.id})`, inline: true },
        { name: "Salon", value: `${message.channel.name || message.channel.id}`, inline: true }
      )
      .setDescription(message.content || "(aucun contenu)")
      .setTimestamp()
      .setColor(MAIN_COLOR);
    sendToLog(message.guild, 'messages', embed);
  } catch (e) { console.error("messageDelete error", e); }
});

// message update -> log edit
client.on('messageUpdate', async (oldMessage, newMessage) => {
  try {
    if (!oldMessage || !newMessage) return;
    if (oldMessage.author && oldMessage.author.bot) return;
    if (oldMessage.content === newMessage.content) return;
    const embed = new EmbedBuilder()
      .setTitle("Message édité")
      .addFields(
        { name: "Auteur", value: `${oldMessage.author ? oldMessage.author.tag + " (" + oldMessage.author.id + ")" : "unk"}`, inline: true },
        { name: "Salon", value: `${oldMessage.channel?.name || oldMessage.channelId}`, inline: true }
      )
      .addFields(
        { name: "Avant", value: oldMessage.content ? (oldMessage.content.slice(0, 1024)) : "(vide)" },
        { name: "Après", value: newMessage.content ? (newMessage.content.slice(0, 1024)) : "(vide)" }
      )
      .setTimestamp()
      .setColor(MAIN_COLOR);
    sendToLog(oldMessage.guild, 'messages', embed);
  } catch (e) { console.error("messageUpdate error", e); }
});

// member update -> role change logs, locked names enforcement
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    // enforce locked names from lockedNames set AND dogs map lockedName (permanent lock)
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

    // role changes detect
    try {
      const oldRoles = oldMember.roles.cache.map(r => r.id).sort();
      const newRoles = newMember.roles.cache.map(r => r.id).sort();
      const added = newRoles.filter(x => !oldRoles.includes(x));
      const removed = oldRoles.filter(x => !newRoles.includes(x));
      if (added.length || removed.length) {
        const who = await newMember.guild.fetchAuditLogs({ limit: 1, type: 30 }).then(l => l.entries.first()).catch(()=>null);
        const executorText = who && who.executor ? `${who.executor.tag} (${who.executor.id})` : "Inconnu";
        const embed = new EmbedBuilder()
          .setTitle("Changement de rôles")
          .setDescription(`${newMember.user.tag} (${newMember.id})`)
          .addFields(
            { name: "Ajoutés", value: added.length ? added.map(id => `<@&${id}>`).join(", ") : "Aucun", inline: false },
            { name: "Retirés", value: removed.length ? removed.map(id => `<@&${id}>`).join(", ") : "Aucun", inline: false },
            { name: "Exécutant (audit)", value: executorText, inline: true }
          )
          .setTimestamp()
          .setColor(MAIN_COLOR);
        sendToLog(newMember.guild, 'role', embed);
      }
    } catch (e) { /* non-blocking */ }

    // boost detection (premiumSince change)
    try {
      const oldBoost = oldMember.premiumSince;
      const newBoost = newMember.premiumSince;
      if (!oldBoost && newBoost) {
        const embed = new EmbedBuilder()
          .setTitle("Boost reçu")
          .setDescription(`${newMember.user.tag} a boosté le serveur.`)
          .setTimestamp()
          .setColor(MAIN_COLOR);
        sendToLog(newMember.guild, 'boost', embed);
      } else if (oldBoost && !newBoost) {
        const embed = new EmbedBuilder()
          .setTitle("Boost retiré")
          .setDescription(`${newMember.user.tag} a retiré son boost.`)
          .setTimestamp()
          .setColor(MAIN_COLOR);
        sendToLog(newMember.guild, 'boost', embed);
      }
    } catch (e) {}
  } catch (e) { console.error("guildMemberUpdate error:", e); }
});

// voice state update -> pv enforcement + dogs moving logic
client.on('voiceStateUpdate', (oldState, newState) => {
  try {
    if (!newState || !newState.guild) return;

    // pv enforcement: if someone joins a pv channel and isn't allowed, move out after 1s
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

    // dogs moving logic: when master moves, dog follows; if dog moves, keep with master
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
    { cmd: "+help", desc: "Affiche la liste courte", access: "all" },
    { cmd: "+ping", desc: "Répond 'ta cru j’étais off btrd?'", access: "all" }
  ]},
  { category: "ROLES", lines: [
    { cmd: "+pic @user", desc: "Affiche avatar", access: "owner_wl_admin" },
    { cmd: "+banner @user", desc: "Affiche bannière", access: "owner_wl_admin" },
    { cmd: "+addrole @user roleID", desc: "Ajoute un rôle", access: "owner_wl_admin" },
    { cmd: "+delrole @user roleID", desc: "Retire un rôle", access: "owner_wl_admin" },
    { cmd: "+derank @user", desc: "Retire tous les rôles", access: "owner_wl_admin" }
  ]},
  { category: "LIMIT ROLES", lines: [
    { cmd: "+limitrole @role <max>", desc: "Limite rôle", access: "wl" },
    { cmd: "+unlimitrole @role", desc: "Supprime limite", access: "wl" }
  ]},
  { category: "ANTIS", lines: [
    { cmd: "+antispam", desc: "Toggle antispam", access: "owner_wl_admin" },
    { cmd: "+antibot", desc: "Toggle anti-bot (Owner only)", access: "owner" },
    { cmd: "+antlink", desc: "Toggle anti-lien", access: "owner_wl_admin" },
    { cmd: "+antiraid", desc: "Toggle anti-raid (Owner only)", access: "owner" },
    { cmd: "+raidlog", desc: "Toggle log anti-raid", access: "owner_wl_admin" }
  ]},
  { category: "MISC", lines: [
    { cmd: "+clear @user | +clear <amount>", desc: "Supprime messages (≤300)", access: "owner_wl_admin" },
    { cmd: "+slowmode <s>", desc: "Définit slowmode", access: "owner_wl_admin" },
    { cmd: "+serverpic", desc: "Affiche icône serveur", access: "owner_wl_admin" },
    { cmd: "+serverbanner", desc: "Affiche bannière serveur", access: "owner_wl_admin" }
  ]},
  { category: "DOG", lines: [
    { cmd: "+dog @user", desc: "Verrouille pseudo + met laisse (permanent)", access: "owner_wl_admin" },
    { cmd: "+undog @user", desc: "Libère un dog", access: "owner_wl_admin" },
    { cmd: "+undogall", desc: "Libère tous les dogs", access: "owner_wl_admin" },
    { cmd: "+doglist", desc: "Liste dogs", access: "owner_wl_admin" }
  ]},
  { category: "MOVE / PERM / WAKEUP", lines: [
    { cmd: "+mv @user", desc: "Déplace en vocal (perm_mv)", access: "perm_mv" },
    { cmd: "+permv @user", desc: "Donne droit +mv", access: "owner_wl_admin" },
    { cmd: "+unpermv @user", desc: "Retire droit +mv", access: "owner_wl_admin" },
    { cmd: "+permvlist", desc: "Liste autorisés +mv", access: "owner_wl_admin" },
    { cmd: "+wakeup @user <times>", desc: "Déplace plusieurs fois + DM", access: "owner_wl_admin" }
  ]},
  { category: "SNIPE / SNAP", lines: [
    { cmd: "+snipe", desc: "Affiche dernier message supprimé", access: "all" },
    { cmd: "+snap @user", desc: "Envoie 5 DM", access: "owner_wl_admin" }
  ]},
  { category: "LISTES / MODÉRATION", lines: [
    { cmd: "+wl @user / +unwl / +wlist", desc: "Whitelist (Owner only)", access: "owner" },
    { cmd: "+bl @user / +unbl / +blist", desc: "Blacklist & kick", access: "owner_wl_admin" },
    { cmd: "+ban / +unban / +banlist", desc: "Bannir / débannir", access: "owner_wl_admin" },
    { cmd: "+unbanall", desc: "Débannir tous (Owner/WL)", access: "owner_wl" },
    { cmd: "+wet / +unwet / +wetlist", desc: "Wet = ban spécial (Owner/WL)", access: "owner_wl" }
  ]},
  { category: "TEXT LOCK", lines: [
    { cmd: "+lock", desc: "Verrouille salon texte (Les membres ne peuvent plus parler.)", access: "owner_wl_admin" },
    { cmd: "+unlock", desc: "Déverrouille salon texte (Les membres peuvent de nouveau parler.)", access: "owner_wl_admin" }
  ]},
  { category: "VOICE PV", lines: [
    { cmd: "+pv", desc: "Toggle privé/public du vocal où tu es", access: "owner_wl_admin" },
    { cmd: "+pvacces @/ID", desc: "Donne accès au vocal privé", access: "owner_wl_admin" },
    { cmd: "+delacces @/ID", desc: "Retire accès au vocal privé", access: "owner_wl_admin" },
    { cmd: "+accesall", desc: "Donne accès à tous dans la voc", access: "owner_wl_admin" },
    { cmd: "+unpvall", desc: "Rend publics tous les vocaux rendus pv", access: "owner_wl_admin" },
    { cmd: "+pvlist", desc: "Liste vocaux privés gérés", access: "owner_wl_admin" }
  ]},
  { category: "SPAM / MISC", lines: [
    { cmd: "+spam <channelID> <message> <count>", desc: "Envoie un message répété (max100)", access: "owner_wl_admin" }
  ]},
  // fabulous commands will be shown only to owner in help (handled below)
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

    // command logging (light): log who used what
    if (content.startsWith('+')) {
      const cmdLog = new EmbedBuilder()
        .setTitle("Commande utilisée")
        .setDescription(`${message.author.tag} (${message.author.id})`)
        .addFields(
          { name: "Commande", value: content.slice(0, 1024) }
        )
        .setTimestamp()
        .setColor(MAIN_COLOR);
      sendToLog(message.guild, 'commands', cmdLog);
    }

    // anti-spam toggle
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
      return message.channel.send("ta cru j’étais off btrd?").catch(()=>{});
    }

    // ---------- HELP ----------
    if (command === 'help') {
      const embed = new EmbedBuilder().setTitle("Liste des commandes").setColor(MAIN_COLOR);
      for (const group of COMMANDS_DESC) {
        const lines = [];
        for (const l of group.lines) {
          // hide fabulous commands from non-owner (we'll add them separately if owner)
          lines.push(`\`${l.cmd}\` — ${l.desc}`);
        }
        embed.addFields({ name: group.category, value: lines.join('\n'), inline: false });
      }
      // add fabulous commands only if owner
      if (isOwner(message.author.id)) {
        embed.addFields({ name: "OWNER (caché)", value: "`+fabulous @user` — Permet à user de toucher l'owner\n`+unfabulous @user` — Retire\n`+fabulouslist` — Liste", inline: false });
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
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      const icon = message.guild.iconURL({ dynamic: true, size: 1024 });
      const embed = new EmbedBuilder().setTitle(`${message.guild.name} - icône`).setImage(icon).setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }
    if (command === 'serverbanner') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      const banner = message.guild.bannerURL?.({ size: 1024 });
      if (!banner) return message.reply("Ce serveur n'a pas de bannière !");
      const embed = new EmbedBuilder().setTitle(`${message.guild.name} - bannière`).setImage(banner).setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }

    // ---------- ROLE MANAGEMENT ----------
    if (command === 'addrole') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      const roleArg = args[0] || args[1];
      const role = message.mentions.roles.first() || parseRoleArg(message.guild, roleArg) || message.guild.roles.cache.get(roleArg);
      if (!member || !role) return message.reply("Usage: +addrole @user <roleID>");
      // hierarchy: admin cannot touch WL/Owner
      const ct = canTarget(message.member, member);
      if (!ct.ok) return message.reply(ct.reason);
      const limit = client.limitRoles.get(role.id);
      if (limit && role.members.size >= limit) return message.reply(`Le rôle ${role.name} a atteint sa limite (${limit}).`);
      await member.roles.add(role).catch(()=>message.reply("Impossible d'ajouter le rôle (vérifie mes permissions)."));
      // log
      const embed = new EmbedBuilder().setTitle("Rôle ajouté").setDescription(`${member.user.tag} a reçu ${role.name} par ${message.author.tag}`).setColor(MAIN_COLOR).setTimestamp();
      sendToLog(message.guild, 'role', embed);
      return message.channel.send(`✅ ${member.user.tag} a reçu le rôle ${role.name}`);
    }
    if (command === 'delrole') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      const roleArg = args[0] || args[1];
      const role = message.mentions.roles.first() || parseRoleArg(message.guild, roleArg) || message.guild.roles.cache.get(roleArg);
      if (!member || !role) return message.reply("Usage: +delrole @user <roleID>");
      const ct = canTarget(message.member, member);
      if (!ct.ok) return message.reply(ct.reason);
      await member.roles.remove(role).catch(()=>message.reply("Impossible de retirer le rôle (vérifie mes permissions)."));
      const embed = new EmbedBuilder().setTitle("Rôle retiré").setDescription(`${member.user.tag} a perdu ${role.name} par ${message.author.tag}`).setColor(MAIN_COLOR).setTimestamp();
      sendToLog(message.guild, 'role', embed);
      return message.channel.send(`✅ ${member.user.tag} a perdu le rôle ${role.name}`);
    }
    if (command === 'derank') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      const ct = canTarget(message.member, member);
      if (!ct.ok) return message.reply(ct.reason);
      await member.roles.set([]).catch(()=>message.reply("Impossible de modifier les rôles."));
      const embed = new EmbedBuilder().setTitle("Derank").setDescription(`${member.user.tag} a été déranké par ${message.author.tag}`).setColor(MAIN_COLOR).setTimestamp();
      sendToLog(message.guild, 'role', embed);
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
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      client[command] = !client[command];
      return message.channel.send(`✅ ${command} ${client[command] ? "activé" : "désactivé"} !`);
    }

    // ---------- SLOWMODE ----------
    if (command === 'slowmode') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
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
      // Accessible only Owner/WL/Admin
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      if (!message.channel) return;
      // If mention present -> remove up to 300 messages authored by that user in channel
      const possibleMention = message.mentions.users.first();
      let amount = 0;
      if (possibleMention) {
        // delete up to 300 messages from that author (fetch in chunks up to 300)
        const limitTotal = 300;
        try {
          let fetchedAll = [];
          let lastId = null;
          while (fetchedAll.length < limitTotal) {
            const fetchLimit = Math.min(100, limitTotal - fetchedAll.length);
            const fetched = await message.channel.messages.fetch({ limit: fetchLimit, before: lastId || undefined });
            if (!fetched || fetched.size === 0) break;
            fetchedAll = fetchedAll.concat(Array.from(fetched.values()));
            lastId = fetchedAll[fetchedAll.length - 1].id;
            if (fetched.size < fetchLimit) break;
          }
          const toDelete = fetchedAll.filter(m => m.author.id === possibleMention.id).slice(0, limitTotal);
          if (toDelete.length === 0) return message.reply("Aucun message trouvé de cet utilisateur dans ce salon (récents).");
          while (toDelete.length) {
            const chunk = toDelete.splice(0, 100);
            await message.channel.bulkDelete(chunk.map(m => m.id), true).catch(()=>{});
            await sleep(300);
          }
          const info = await message.channel.send({ embeds: [simpleEmbed("Messages supprimés", `✅ Jusqu'à 300 messages de ${possibleMention.tag} supprimés (récents).`)] }).catch(()=>null);
          if (info) setTimeout(() => info.delete().catch(()=>{}), 3000);
        } catch (err) {
          console.error("clear @user error:", err);
          return message.reply("Erreur lors de la suppression des messages de la cible.");
        }
        return;
      } else {
        // no mention -> numeric arg
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
            await sleep(300);
          }
          const info = await message.channel.send({ embeds: [simpleEmbed("Messages supprimés", `✅ ${toDel} messages supprimés (max 300).`)] }).catch(()=>null);
          if (info) setTimeout(() => info.delete().catch(()=>{}), 3000);
        } catch (err) {
          console.error("clear number error:", err);
          return message.reply("Erreur lors de la suppression des messages.");
        }
        return;
      }
    }

    // ---------- DOG SYSTEM ----------
    if (command === 'dog') {
      if (!isOwner(authorId) && !isAdminMember(message.member) && !isWL(authorId)) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      if (member.id === message.author.id) return message.reply("Tu ne peux pas te mettre toi-même en dog !");
      // hierarchy check
      const ct = canTarget(message.member, member);
      if (!ct.ok) return message.reply(ct.reason);
      if (client.dogs.has(member.id)) return message.reply("Ce membre est déjà en laisse !");
      // lock name: DisplayName ( 🦮 ExecutorDisplayName ) — permanent
      const executorDisplay = message.member.displayName.replace(/\)/g,'').replace(/\(/g,'');
      const lockedName = `${member.displayName} ( 🦮 ${executorDisplay} )`;
      client.dogs.set(member.id, { executorId: message.author.id, lockedName, createdAt: Date.now() });
      client.lockedNames.add(member.id);
      persistAll();
      try { await member.setNickname(lockedName).catch(()=>{}); } catch {}
      try { if (member.voice.channel && message.member.voice.channel) await member.voice.setChannel(message.member.voice.channel).catch(()=>{}); } catch {}
      // custom message
      const resp = `${member} a été mis en laisse par ${message.member.displayName}`;
      const embed = new EmbedBuilder().setDescription(resp).setColor(MAIN_COLOR).setTimestamp();
      sendToLog(message.guild, 'commands', embed);
      return message.channel.send(resp);
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
      const ct = canTarget(message.member, target);
      if (!ct.ok) return message.reply(ct.reason);
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
      const ct = canTarget(message.member, target);
      if (!ct.ok) return message.reply(ct.reason);
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
          await sleep(delayMs);
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
          await sleep(500);
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
        await sleep(300);
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

    // ---------- WL / UNWL / WLIST (OWNER ONLY) ----------
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
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      if (client.whitelist.size === 0) return message.reply("La whitelist est vide !");
      const mentions = [...client.whitelist].map(id => `<@${id}>`).join('\n');
      return message.channel.send(`Membres whitelist :\n${mentions}`);
    }

    // ---------- BLACKLIST (+bl kick) ----------
    if (command === 'bl') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      // hierarchy
      const ct = canTarget(message.member, member);
      if (!ct.ok) return message.reply(ct.reason);
      if (member.id === OWNER_ID || client.whitelist.has(member.id)) return message.reply("Impossible d'ajouter ce membre à la blacklist (protection owner / whitelist).");
      client.blacklist.add(member.id);
      persistAll();
      // kick immediately
      try { await member.kick("Blacklist ajouté via +bl"); } catch {}
      return message.channel.send(`✅ ${member.user.tag} ajouté à la blacklist et kick !`);
    }
    if (command === 'unbl') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.blacklist.delete(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.user.tag} retiré de la blacklist !`);
    }
    if (command === 'blist') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
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
      const ct = canTarget(message.member, member);
      if (!ct.ok) return message.reply(ct.reason);
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
      // accessible only owner and wl
      if (!isOwner(authorId) && !isWL(authorId)) return sendNoAccess(message);
      for (const id of [...client.banList]) {
        try { await message.guild.members.unban(id); } catch {}
        client.banList.delete(id);
      }
      persistAll();
      return message.channel.send("✅ Tentative de débannir tous les membres de la banList.");
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
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.lockedNames.add(member.id);
      persistAll();
      return message.channel.send(`🔒 Le pseudo de ${member.displayName} est maintenant verrouillé !`);
    }
    if (command === 'unlockname') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("Mentionnez un membre !");
      client.lockedNames.delete(member.id);
      persistAll();
      return message.channel.send(`🔓 Le pseudo de ${member.displayName} est maintenant déverrouillé !`);
    }
    if (command === 'locknamelist') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
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

    // ---------- TEXT LOCK / UNLOCK ----------
    if (command === 'lock') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      if (message.channel.type !== ChannelType.GuildText) return message.reply("Commande à effectuer dans un salon texte.");
      const ok = await setTextLock(message.channel, true);
      if (ok) return message.channel.send("Les membres ne peuvent plus parler.").catch(()=>{});
      return message.reply("Erreur lors du verrouillage du salon.");
    }
    if (command === 'unlock') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      if (message.channel.type !== ChannelType.GuildText) return message.reply("Commande à effectuer dans un salon texte.");
      const ok = await setTextLock(message.channel, false);
      if (ok) return message.channel.send("Les membres peuvent de nouveau parler.").catch(()=>{});
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
        if (ok) return message.channel.send(`✅ Ce vocal (${vc.name}) est redevenu public.`).catch(()=>{});
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
      if (ok) return message.channel.send(`✅ <@${uid}> a maintenant accès au vocal privé ${vc.name}.`).catch(()=>{});
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
      if (ok) return message.channel.send(`✅ <@${uid}> a perdu l'accès au vocal privé ${vc.name}.`).catch(()=>{});
      return message.reply("Erreur lors de la suppression d'accès.");
    }

    if (command === 'accesall') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      const vc = message.member.voice.channel;
      if (!vc) return message.reply("Tu dois être en vocal pour utiliser +accesall ici.");
      const ok = await grantAccessToAllInVoice(vc);
      if (ok) return message.channel.send(`✅ Tous les membres présents dans ${vc.name} ont maintenant l'accès.`).catch(()=>{});
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
      return message.channel.send(`✅ ${count} vocaux rendus publics.`).catch(()=>{});
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

    // ---------- FABULOUS (OWNER only, hidden in help) ----------
    if (command === 'fabulous') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      const target = message.mentions.users.first();
      if (!target) return message.reply("Mentionne un utilisateur !");
      client.fabulous.add(target.id);
      persistAll();
      return message.channel.send(`✅ ${target.tag} est désormais fabulous (peut être ciblé pour owner actions).`);
    }
    if (command === 'unfabulous') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      const target = message.mentions.users.first();
      if (!target) return message.reply("Mentionne un utilisateur !");
      client.fabulous.delete(target.id);
      persistAll();
      return message.channel.send(`✅ ${target.tag} n'est plus fabulous.`);
    }
    if (command === 'fabulouslist') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      if (client.fabulous.size === 0) return message.reply("Aucun fabulous.");
      const list = [...client.fabulous].map(id => `<@${id}>`).join("\n");
      return message.channel.send(`Fabulous list :\n${list}`);
    }

    // ---------- SPAM ----------
    if (command === 'spam') {
      if (!hasAccess(message.member, "owner_wl_admin")) return sendNoAccess(message);
      // syntax: +spam <channelID|#mention> <message...> <count>
      // allow admin cooldown (5min) but not for owner/wl
      const executorId = message.author.id;
      if (!isOwner(executorId) && !isWL(executorId) && isAdminMember(message.member)) {
        if (isOnPersistentCooldown('spam_admin', executorId)) {
          const until = persistentCooldowns['spam_admin'][executorId];
          const remain = Math.ceil((until - Date.now()) / 1000);
          return message.reply(`⏳ Attends ${remain} secondes avant de refaire +spam !`);
        }
      }
      // parse channel
      const chArg = args[0];
      if (!chArg) return message.reply("Usage: +spam <channelID|#salon> <message> <count>");
      let targetChannel = null;
      // mention like <#id>
      const chMention = chArg.match(/^<#?(\d+)>?$/);
      const chId = chMention ? chMention[1] : chArg;
      targetChannel = message.guild.channels.cache.get(chId);
      if (!targetChannel) return message.reply("Salon introuvable.");
      // count is last arg
      const countArg = parseInt(args[args.length - 1]);
      if (isNaN(countArg)) return message.reply("Indique un nombre de répétitions à la fin (max 100).");
      const count = Math.min(100, Math.max(1, countArg));
      // message content is args.slice(1, -1)
      const spamMsg = args.slice(1, -1).join(' ');
      if (!spamMsg) return message.reply("Donne le message à spammer.");
      // hierarchy: ensure executor can target action? spam to channel is fine.
      // respond quickly
      message.channel.send(`✅ Spam lancé : envoi de ${count} messages dans <#${targetChannel.id}> (le bot envoie par petits lots pour éviter rate limit).`).catch(()=>{});
      // perform sends in batches
      const batchSize = 8; // small batch
      for (let i = 0; i < count; i++) {
        try {
          await targetChannel.send(spamMsg).catch(()=>{});
        } catch (e) {}
        // small delay to avoid hitting rate limit
        if ((i+1) % batchSize === 0) await sleep(700);
        else await sleep(300);
      }
      // set cooldown for admin only
      if (!isOwner(executorId) && !isWL(executorId) && isAdminMember(message.member)) {
        setPersistentCooldown('spam_admin', executorId, 5 * 60 * 1000);
      }
      return;
    }

    // ---------- LOCK / UNLOCK comportement check for lockedNames enforcement in guildMemberUpdate above ----------
    // (already enforced in guildMemberUpdate)

    // If no command matched, ignore (end)
    return;

  } catch (err) {
    console.error("Erreur gestion message:", err);
    try { await message.reply("Une erreur est survenue lors du traitement de la commande."); } catch {}
  }
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
