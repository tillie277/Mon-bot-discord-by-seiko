// index.js - Bot tout-en-un
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');

// -------------------- CONFIG --------------------
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "726063885492158474"; // Remplace par ton ID
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

// -------------------- DATA EN MÉMOIRE --------------------
client.whitelist = new Set();
client.adminUsers = new Set();
client.blacklist = new Set();
client.wetList = new Set();
client.banList = new Set();
client.dogs = new Map(); // targetId -> { executorId, lockedName }
client.permMvUsers = new Set();
client.limitRoles = new Map(); // roleId -> limit
client.lockedNames = new Set();
client.snipes = new Map(); // channelId -> {content, author, timestamp}
client.messageLastTs = new Map(); // antidoublon: per-user last command timestamp
client.processingMessageIds = new Set(); // anti-double-process

let persistentCooldowns = {};
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
const shortCmdCooldownMs = 800; // antidoublon
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

// -------------------- KEEPALIVE --------------------
http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); }).listen(PORT, () => console.log(`HTTP keepalive on port ${PORT}`));
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
setInterval(() => pingExternal(EXTERNAL_PING_URL), 5 * 60 * 1000);

// -------------------- EVENTS --------------------
client.on('ready', () => console.log(`Bot connecté en tant que ${client.user.tag}`));

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  // simple snipe
  client.snipes.set(msg.channel.id, { content: msg.content, author: msg.author.tag, timestamp: Date.now() });

  // antidoublon
  const last = client.messageLastTs.get(msg.author.id) || 0;
  if (Date.now() - last < shortCmdCooldownMs) return;
  client.messageLastTs.set(msg.author.id, Date.now());

  if (!msg.content.startsWith("!")) return;
  const args = msg.content.slice(1).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  // -------------------- COMMANDES DE BASE --------------------
  if (cmd === "ping") return msg.channel.send({ embeds: [simpleEmbed("Pong!", "🏓")] });
  if (cmd === "snipe") {
    const snipe = client.snipes.get(msg.channel.id);
    if (!snipe) return msg.reply("Rien à snipe ici !");
    return msg.channel.send({ embeds: [simpleEmbed(`Snipe de ${snipe.author}`, snipe.content)] });
  }

  // -------------------- WHITELIST / BLACKLIST --------------------
  if (cmd === "whitelist") {
    if (!isOwner(msg.author.id)) return sendNoAccess(msg);
    const member = parseMemberArg(msg.guild, args[0]);
    if (!member) return msg.reply("Membre invalide !");
    client.whitelist.add(member.id);
    persistAll();
    return msg.reply(`${member.user.tag} ajouté à la whitelist ✅`);
  }

  if (cmd === "blacklist") {
    if (!isOwner(msg.author.id)) return sendNoAccess(msg);
    const member = parseMemberArg(msg.guild, args[0]);
    if (!member) return msg.reply("Membre invalide !");
    client.blacklist.add(member.id);
    persistAll();
    return msg.reply(`${member.user.tag} ajouté à la blacklist ⚠️`);
  }

  // -------------------- DOGS / LOCKNAME --------------------
  if (cmd === "dogs") {
    if (!isAdminMember(msg.member)) return sendNoAccess(msg);
    const member = parseMemberArg(msg.guild, args[0]);
    if (!member) return msg.reply("Membre invalide !");
    const name = args.slice(1).join(" ");
    if (!name) return msg.reply("Nom à verrouiller manquant !");
    client.dogs.set(member.id, { executorId: msg.author.id, lockedName: name });
    client.lockedNames.add(name);
    persistAll();
    return msg.reply(`${member.user.tag} a son nom verrouillé en "${name}" 🔒`);
  }

  // -------------------- SNAP / WAKEUP --------------------
  if (cmd === "snap") {
    if (!isAdminMember(msg.member)) return sendNoAccess(msg);
    const member = parseMemberArg(msg.guild, args[0]);
    if (!member) return msg.reply("Membre invalide !");
    if (isOnPersistentCooldown("snap", member.id)) return msg.reply("Ce membre est déjà snapé ⏳");
    setPersistentCooldown("snap", member.id, 10 * 60 * 1000); // 10 min
    return msg.reply(`${member.user.tag} snapé ! 💥`);
  }

  if (cmd === "wakeup") {
    if (!isAdminMember(msg.member)) return sendNoAccess(msg);
    const member = parseMemberArg(msg.guild, args[0]);
    if (!member) return msg.reply("Membre invalide !");
    setPersistentCooldown("snap", member.id, 0); // reset snap
    return msg.reply(`${member.user.tag} réveillé ✅`);
  }

  // -------------------- BAN / WET --------------------
  if (cmd === "ban") {
    if (!isAdminMember(msg.member)) return sendNoAccess(msg);
    const member = parseMemberArg(msg.guild, args[0]);
    if (!member) return msg.reply("Membre invalide !");
    try { await member.ban({ reason: `Ban par ${msg.author.tag}` }); } catch {}
    client.banList.add(member.id);
    persistAll();
    return msg.reply(`${member.user.tag} banni ⚠️`);
  }

  if (cmd === "wet") {
    if (!isAdminMember(msg.member)) return sendNoAccess(msg);
    const member = parseMemberArg(msg.guild, args[0]);
    if (!member) return msg.reply("Membre invalide !");
    client.wetList.add(member.id);
    persistAll();
    return msg.reply(`${member.user.tag} ajouté à la wet list ✅`);
  }

  // -------------------- PERMMV --------------------
  if (cmd === "permmv") {
    if (!isAdminMember(msg.member)) return sendNoAccess(msg);
    const member = parseMemberArg(msg.guild, args[0]);
    if (!member) return msg.reply("Membre invalide !");
    client.permMvUsers.add(member.id);
    persistAll();
    return msg.reply(`${member.user.tag} peut maintenant rejoindre n'importe quel VC 🔊`);
  }

  // -------------------- LIMITROLES --------------------
  if (cmd === "limitroles") {
    if (!isAdminMember(msg.member)) return sendNoAccess(msg);
    const role = parseRoleArg(msg.guild, args[0]);
    const limit = parseInt(args[1]);
    if (!role || isNaN(limit)) return msg.reply("Role ou limite invalide !");
    client.limitRoles.set(role.id, limit);
    persistAll();
    return msg.reply(`Rôle ${role.name} limité à ${limit} membres ⚖️`);
  }
});

// -------------------- LOGIN --------------------
client.login(process.env.TOKEN);
