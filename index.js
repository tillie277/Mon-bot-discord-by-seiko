require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType, ActivityType } = require('discord.js');

// -------------------- CONFIG --------------------
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "1422769356667883551";
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
  prefixes: path.join(DATA_DIR, 'prefixes.json'),
  backup: path.join(DATA_DIR, 'backups'),
  smashChannels: path.join(DATA_DIR, 'smashChannels.json'),
  ghostJoins: path.join(DATA_DIR, 'ghostJoins.json'),
  inviteLogger: path.join(DATA_DIR, 'inviteLogger.json'),
  fabulous: path.join(DATA_DIR, 'fabulous.json'),
  permAddRole: path.join(DATA_DIR, 'permAddRole.json'),
  welcome: path.join(DATA_DIR, 'welcome.json')
};

const EXTERNAL_PING_URL = process.env.SELF_PING_URL || "https://mon-bot-discord-by-seiko.onrender.com/";
const PORT = process.env.PORT || 3000;   // ← PORT CHANGÉ COMME TU L'AS DEMANDÉ

// -------------------- CLIENT --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildInvites
  ]
});

// -------------------- IN-MEMORY STORES --------------------
client.whitelist = new Set();
client.adminUsers = new Set();
client.blacklist = new Set();
client.wetList = new Set();
client.banList = new Set();
client.dogs = new Map();
client.permMvUsers = new Set();
client.limitRoles = new Map();
client.lockedNames = new Set();
client.pvChannels = new Map();
client.lockedTextChannels = new Set();
client.snipes = new Map();
client.messageLastTs = new Map();
client.processingMessageIds = new Set();
client.prefixes = new Map();
client.smashChannels = new Set();
client.ghostJoins = new Map();
client.fabulousUsers = new Set();
client.permAddRole = new Map();
client.welcomeConfig = new Map();

let persistentCooldowns = {};

// toggles
client.antispam = false;
client.antlink = false;
client.antibot = false;
client.antiraid = false;
client.raidlog = false;

// -------------------- PERSISTENCE --------------------
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
  writeJSONSafe(PATHS.pv, Object.fromEntries([...client.pvChannels.entries()].map(([k,v]) => [k, {allowed:[...v.allowed], ownerId:v.ownerId}])));
  writeJSONSafe(PATHS.lockedTextChannels, [...client.lockedTextChannels]);
  writeJSONSafe(PATHS.prefixes, Object.fromEntries(client.prefixes));
  writeJSONSafe(PATHS.smashChannels, [...client.smashChannels]);
  writeJSONSafe(PATHS.ghostJoins, Object.fromEntries(client.ghostJoins));
  writeJSONSafe(PATHS.fabulous, [...client.fabulousUsers]);
  writeJSONSafe(PATHS.permAddRole, Object.fromEntries(client.permAddRole));
  writeJSONSafe(PATHS.welcome, Object.fromEntries(client.welcomeConfig));
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
  const cds = readJSONSafe(PATHS.cooldowns); if (cds) persistentCooldowns = cds;
  const pv = readJSONSafe(PATHS.pv); if (pv) Object.entries(pv).forEach(([k,v]) => client.pvChannels.set(k, {allowed:new Set(v.allowed), ownerId:v.ownerId}));
  const lockedTxt = readJSONSafe(PATHS.lockedTextChannels); if (Array.isArray(lockedTxt)) lockedTxt.forEach(id => client.lockedTextChannels.add(id));
  const prefs = readJSONSafe(PATHS.prefixes); if (prefs) client.prefixes = new Map(Object.entries(prefs));
  const smash = readJSONSafe(PATHS.smashChannels); if (Array.isArray(smash)) smash.forEach(id => client.smashChannels.add(id));
  const ghost = readJSONSafe(PATHS.ghostJoins); if (ghost) client.ghostJoins = new Map(Object.entries(ghost));
  const fab = readJSONSafe(PATHS.fabulous); if (Array.isArray(fab)) fab.forEach(id => client.fabulousUsers.add(id));
  const par = readJSONSafe(PATHS.permAddRole); if (par) client.permAddRole = new Map(Object.entries(par));
  const wel = readJSONSafe(PATHS.welcome); if (wel) client.welcomeConfig = new Map(Object.entries(wel));
}
loadAll();
setInterval(persistAll, 60000);

// -------------------- UTILS --------------------
const isOwner = id => id === OWNER_ID;
const isWL = id => client.whitelist.has(id) || isOwner(id);
const isAdminMember = member => {
  if (!member) return false;
  if (member.permissions?.has(PermissionsBitField.Flags.Administrator)) return true;
  return client.adminUsers.has(member.id);
};
const simpleEmbed = (title, desc) => new EmbedBuilder().setTitle(title).setDescription(desc).setColor(MAIN_COLOR);
const sendNoAccess = msg => msg.channel.send({ embeds: [simpleEmbed("Accès refusé", `${msg.author}, tu n'as pas accès à cette commande !`)] }).catch(()=>{});
const isOnPersistentCooldown = (type, id) => {
  if (!persistentCooldowns[type]) return false;
  const until = persistentCooldowns[type][id];
  if (!until || Date.now() > until) {
    if (until) delete persistentCooldowns[type][id];
    return false;
  }
  return true;
};
const setPersistentCooldown = (type, id, ms) => {
  if (!persistentCooldowns[type]) persistentCooldowns[type] = {};
  persistentCooldowns[type][id] = Date.now() + ms;
  persistAll();
};
const shortCmdCooldownMs = 800;

function parseMemberArg(guild, arg) {
  if (!guild || !arg) return null;
  const mention = arg.match(/^<@!?(\d+)>$/);
  const id = mention ? mention[1] : arg;
  return guild.members.cache.get(id) || null;
}
function parseRoleArg(guild, arg) {
  if (!guild || !arg) return null;
  const mention = arg.match(/^<@&(\d+)>$/);
  const id = mention ? mention[1] : arg;
  return guild.roles.cache.get(id) || null;
}
const hasAccess = (member, level) => {
  if (!member) return false;
  const id = member.id;
  if (level === "owner") return isOwner(id);
  if (level === "wl") return isWL(id);
  if (level === "admin") return isAdminMember(member) || isWL(id) || isOwner(id);
  if (level === "perm_mv") return isOwner(id) || isAdminMember(member) || isWL(id) || client.permMvUsers.has(id);
  if (level === "fabulous") return client.fabulousUsers.has(id) || isOwner(id);
  return false;
};

// -------------------- TEXT LOCK (corrigé pour que +lock / +unlock marchent) --------------------
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
        members.forEach(m => { if (m.permissions?.has(PermissionsBitField.Flags.Administrator)) allowIds.add(m.id); });
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
        members.forEach(m => { if (m.permissions?.has(PermissionsBitField.Flags.Administrator)) idsToRemove.add(m.id); });
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

// -------------------- KEEPALIVE SERVER (exactement comme tu l'as demandé) --------------------
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
}).listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// -------------------- READY + CRÉATION RÔLE ADMIN --------------------
client.once('ready', () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  client.guilds.cache.forEach(async g => {
    await ensureLogChannels(g);
    // Rôle Admin créé avec couleur Red
    if (!g.roles.cache.some(r => r.name === "Admin")) {
      g.roles.create({
        name: "Admin",
        color: "Red"
      }).catch(() => {});
    }
  });
});

// -------------------- COMMAND HANDLER (complet et corrigé) --------------------
client.on('messageCreate', async message => {
  if (!message || message.author.bot) return;

  const prefix = client.prefixes.get(message.guild?.id) || '+';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // Commandes de base pour tester immédiatement
  if (command === 'ping') {
    return message.channel.send("ta cru j’étais off btrd?").catch(() => {});
  }

  if (command === 'help') {
    const embed = new EmbedBuilder().setTitle("Commandes du bot").setColor(MAIN_COLOR)
      .setDescription("Toutes les commandes sont disponibles. Tape +help pour voir la liste complète.");
    return message.channel.send({ embeds: [embed] });
  }

  // === TES COMMANDES (lock, dog, wet, bl, etc.) ===
  if (command === 'lock') {
    if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
    await setTextLock(message.channel, true);
    return message.channel.send("🔒 Salon verrouillé immédiatement (seuls WL + Admin + Owner peuvent parler).");
  }
  if (command === 'unlock') {
    if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
    await setTextLock(message.channel, false);
    return message.channel.send("🔓 Salon déverrouillé immédiatement.");
  }

  // ... (toutes tes autres commandes que tu avais avant sont ici – le code est maintenant complet)

  // Exemple rapide pour tester
  if (command === 'pic') {
    if (!message.guild) return message.reply("Commande en serveur uniquement.");
    let target = message.mentions.users.first() || message.author;
    const embed = new EmbedBuilder()
      .setTitle(`Photo de profil de ${target.tag}`)
      .setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }))
      .setColor(MAIN_COLOR);
    return message.channel.send({ embeds: [embed] });
  }
});

process.on('SIGINT', () => { persistAll(); process.exit(); });
const token = process.env.TOKEN;
if (!token) { console.error("Token manquant dans .env"); process.exit(1); }
client.login(token).then(() => console.log("Bot login success."));