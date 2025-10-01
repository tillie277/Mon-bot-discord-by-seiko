// index.js - Version finale unifiée
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType
} = require('discord.js');

// -------------------- CONFIG --------------------
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "726063885492158474"; // Owner fixe demandé
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

const EXTERNAL_PING_URL = process.env.SELF_PING_URL || process.env.EXTERNAL_PING_URL || null;

// -------------------- CLIENT --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// -------------------- IN-MEMORY STORES --------------------
client.whitelist = new Set();
client.adminUsers = new Set(); // custom admins via +admin
client.blacklist = new Set();
client.wetList = new Set();
client.banList = new Set();
client.dogs = new Map(); // dogId -> masterId
client.permMvUsers = new Set();
client.limitRoles = new Map(); // roleId -> max
client.lockedNames = new Set();

client.snipes = new Map(); // channelId -> {content, author, timestamp}
client.messageShortCooldown = new Map(); // per-user short anti-double-command
client.processingMessageIds = new Set(); // prevent duplicate events

// persistent cooldowns: { snap: { userId: expiryTs }, wakeup: {...} }
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

// antispam consecutive counters (in-memory)
const consecutiveCount = new Map();

// wakeup in progress targets (avoid overlapping)
client.wakeupInProgress = new Set();

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
  try {
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
  } catch (e) { console.error("persistAll error", e); }
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
setInterval(persistAll, 60_000); // autosave every minute

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
const sendNoAccess = msg => msg.channel.send({ embeds: [simpleEmbed("❌ Accès refusé", `${msg.author}, tu n'as pas accès à cette commande !`)] }).catch(()=>{});
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
  const mention = arg.toString().match(/^<@&(\d+)>$/);
  const id = mention ? mention[1] : arg;
  return guild.roles.cache.get(id) || null;
}
const ownerOrWLOnly = id => isOwner(id) || isWL(id);

// -------------------- KEEPALIVE (local + external) --------------------
const PORT = process.env.PORT || 3000;
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
if (EXTERNAL_PING_URL) setInterval(() => pingExternal(EXTERNAL_PING_URL), 5 * 60 * 1000);

// -------------------- EVENTS --------------------
client.on('messageDelete', message => {
  if (!message || !message.author || message.author.bot) return;
  if (message.channel) client.snipes.set(message.channel.id, { content: message.content || "", author: message.author, timestamp: Date.now() });
});

// Kick blacklisted members who rejoin after 3s
client.on('guildMemberAdd', async member => {
  try {
    if (client.blacklist.has(member.id)) {
      setTimeout(() => {
        member.kick("Membre blacklisté (rejoin)").catch(()=>{});
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
      client._recentJoins.set(member.guild.id, arr.filter(t => now - t < 10000));
      const filtered = client._recentJoins.get(member.guild.id);
      if (filtered.length > 3) {
        const members = await member.guild.members.fetch().catch(()=>null);
        if (members) {
          for (const [id, m] of members) {
            if (now - (m.joinedTimestamp || 0) < 15000 && !m.permissions.has(PermissionsBitField.Flags.Administrator)) {
              try { m.kick("Anti-raid: joins massifs détectés").catch(()=>{}); } catch {}
            }
          }
        }
        if (client.raidlog && member.guild.systemChannel) {
          const embed = new EmbedBuilder().setTitle("🚨 Anti-raid activé").setDescription("Joins massifs détectés. Actions prises automatiquement.").setColor(MAIN_COLOR).setTimestamp();
          member.guild.systemChannel.send({ embeds: [embed] }).catch(()=>{});
        }
      }
    }
  } catch (e) { console.error("guildMemberAdd error:", e); }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    if (client.lockedNames && client.lockedNames.has(newMember.id)) {
      if (oldMember?.nickname !== newMember?.nickname) {
        await newMember.setNickname(oldMember?.nickname || newMember.user.username).catch(()=>{});
      }
    }
  } catch (e) { console.error("guildMemberUpdate error:", e); }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  try {
    if (!newState || !newState.guild) return;
    client.dogs.forEach((masterId, dogId) => {
      const master = newState.guild.members.cache.get(masterId);
      const dog = newState.guild.members.cache.get(dogId);
      if (!master || !dog) return;
      if (newState.member?.id === masterId && newState.channelId) {
        if (dog.voice.channelId !== newState.channelId) dog.voice.setChannel(newState.channelId).catch(()=>{});
      }
      if (newState.member?.id === dogId && master.voice.channelId && dog.voice.channelId !== master.voice.channelId) {
        dog.voice.setChannel(master.voice.channelId).catch(()=>{});
      }
    });
  } catch (e) { console.error("voiceStateUpdate dogs error:", e); }
});

// -------------------- COMMAND LIST (used by +help) --------------------
// Each command: name, one-line description, access label
const COMMANDS = [
  // GENERAL
  { name: "help", desc: "Affiche toutes les commandes organisées par catégorie (accessible selon ton rôle)", access: "all" },
  { name: "ping", desc: "Répond 'ta cru j’étais mort btrd?'", access: "all" },
  { name: "pic", desc: "Affiche la photo de profil d'un membre (ou la tienne)", access: "all" },
  { name: "banner", desc: "Récupère la bannière d'un membre", access: "all" },

  // ROLES
  { name: "addrole", desc: "Ajoute un rôle à un membre", access: "adminwl" },
  { name: "delrole", desc: "Retire un rôle d'un membre", access: "adminwl" },
  { name: "derank", desc: "Retire tous les rôles d'un membre", access: "adminwl" },

  // LIMIT ROLES
  { name: "limitrole", desc: "Définit une limite pour un rôle", access: "wl_owner" },
  { name: "unlimitrole", desc: "Supprime la limite d'un rôle", access: "wl_owner" },

  // ANTIS
  { name: "antispam", desc: "Active/désactive l'antispam (avertit après 5 messages consécutifs)", access: "adminwl" },
  { name: "antibot", desc: "Active/désactive anti-bot", access: "adminwl" },
  { name: "antlink", desc: "Active/désactive le blocage des liens", access: "adminwl" },
  { name: "antiraid", desc: "Active/désactive anti-raid (owner only)", access: "owner" },
  { name: "raidlog", desc: "Active/désactive le log raid", access: "adminwl" },

  // MISC
  { name: "slowmode", desc: "Définit le slowmode du salon", access: "adminwl" },
  { name: "serverpic", desc: "Affiche l'icône du serveur", access: "adminwl" },
  { name: "serverbanner", desc: "Affiche la bannière du serveur", access: "adminwl" },

  // DOG SYSTEM
  { name: "dog", desc: "Met un membre en 'dog' (système de laisse)", access: "owner_admin_wl" },
  { name: "undog", desc: "Libère un membre de la laisse", access: "owner_admin_wl" },
  { name: "undogall", desc: "Libère tous les dogs", access: "owner_admin_wl" },
  { name: "doglist", desc: "Affiche la liste des dogs", access: "owner_admin_wl" },

  // MOVE / PERMV / WAKEUP / SNAP
  { name: "mv", desc: "Déplace un membre vers ton channel vocal (requires permission)", access: "perm_mv" },
  { name: "permv", desc: "Donne la permission permanente +mv à un membre", access: "owner_admin_wl" },
  { name: "unpermv", desc: "Retire la permission permanente +mv", access: "owner_admin_wl" },
  { name: "permvlist", desc: "Affiche la liste des membres autorisés à +mv", access: "owner_admin_wl" },
  { name: "wakeup", desc: "Déplace une cible dans différents vocaux X fois et envoie des DM (cooldown 5min)", access: "owner_admin_wl" },
  { name: "snap", desc: "Envoie 5 DMs demandant le snap (cooldown 5min)", access: "adminwl" },

  // LISTES / MODERATION
  { name: "wl", desc: "Ajoute à la whitelist (owner only)", access: "owner" },
  { name: "unwl", desc: "Retire de la whitelist (owner only)", access: "owner" },
  { name: "wlist", desc: "Affiche la whitelist (owner only)", access: "owner" },

  { name: "bl", desc: "Ajoute à la blacklist (admin/WL/owner)", access: "adminwl" },
  { name: "unbl", desc: "Retire de la blacklist (admin/WL/owner)", access: "adminwl" },
  { name: "blist", desc: "Affiche la blacklist (admin/WL/owner)", access: "adminwl" },

  { name: "ban", desc: "Bannit un membre (owner/WL/admin)", access: "ban_access" },
  { name: "unban", desc: "Débannit un membre (owner/WL/admin)", access: "ban_access" },
  { name: "banlist", desc: "Affiche la banList (owner/WL/admin)", access: "ban_access" },
  { name: "unbanall", desc: "Débannit tous les membres listés (owner only)", access: "owner" },

  { name: "wet", desc: "Banni et ajoute à wetList (owner/WL)", access: "wet_access" },
  { name: "unwet", desc: "Retire de la wetList et débannit (owner/WL)", access: "wet_access" },
  { name: "wetlist", desc: "Affiche la wetList (owner/WL)", access: "wet_access" },

  // LOCKNAME
  { name: "lockname", desc: "Verrouille le pseudo d'un membre (admin/WL/owner)", access: "adminwl" },
  { name: "unlockname", desc: "Déverrouille le pseudo d'un membre (admin/WL/owner)", access: "adminwl" },
  { name: "locknamelist", desc: "Affiche les pseudos verrouillés", access: "adminwl" },

  // ADMIN CUSTOM
  { name: "admin", desc: "Donne la permission custom admin (owner/WL)", access: "ownerwl" },
  { name: "unadmin", desc: "Retire la permission custom admin (owner/WL)", access: "ownerwl" },
  { name: "adminlist", desc: "Affiche les admins custom et admins rôles", access: "ownerwl" },

  // CLEAR / SNIPE / OTHER
  { name: "clear", desc: "Supprime des messages (admin/WL/owner)", access: "clear_access" },
  { name: "snipe", desc: "Affiche le dernier message supprimé (3s)", access: "all" }
];

// helper to check access according to final requirements
function hasAccess(member, accessKey) {
  if (!member) return false;
  const uid = member.id;

  switch (accessKey) {
    case "all": return true;
    case "owner": return isOwner(uid);
    case "wl": return isWL(uid);
    case "adminwl": return isAdminMember(member) || isWL(uid) || isOwner(uid);
    case "ownerwl": return ownerOrWLOnly(uid);
    case "wl_owner": return isWL(uid) || isOwner(uid);
    case "owner_admin_wl": return isOwner(uid) || isAdminMember(member) || isWL(uid);
    case "perm_mv": return isOwner(uid) || isAdminMember(member) || isWL(uid) || client.permMvUsers.has(uid);
    case "ban_access": return isOwner(uid) || isWL(uid) || isAdminMember(member);
    case "wet_access": return isWL(uid) || isOwner(uid);
    case "clear_access": return isOwner(uid) || isWL(uid) || isAdminMember(member) || (member.permissions && member.permissions.has && member.permissions.has(PermissionsBitField.Flags.ManageMessages));
    default: return false;
  }
}

// -------------------- COMMAND HANDLER --------------------
client.on('messageCreate', async message => {
  try {
    if (!message || !message.author || message.author.bot) return;

    // prevent duplicate processing of same message id
    if (client.processingMessageIds.has(message.id)) return;
    client.processingMessageIds.add(message.id);
    setTimeout(() => client.processingMessageIds.delete(message.id), 5000);

    const content = message.content || "";
    // short per-user command cooldown to prevent duplicates
    const last = client.messageShortCooldown.get(message.author.id) || 0;
    if (Date.now() - last < shortCmdCooldownMs && !isOwner(message.author.id)) {
      return;
    }
    client.messageShortCooldown.set(message.author.id, Date.now());

    // ---------------- ANTISPAM (toggleable) ----------------
    if (client.antispam && !isOwner(message.author.id)) {
      const uid = message.author.id;
      const prev = consecutiveCount.get(uid) || 0;
      const nowCount = prev + 1;
      consecutiveCount.set(uid, nowCount);

      // reduce counter after 4 seconds by 1 (so only very close messages count)
      setTimeout(() => {
        const cur = consecutiveCount.get(uid) || 0;
        consecutiveCount.set(uid, Math.max(0, cur - 1));
      }, 4000);

      if (nowCount >= 5) {
        // send warning (auto-delete after 2s)
        const warn = await message.channel.send({ embeds: [simpleEmbed("⚠️ Spam détecté", `${message.author}, attention — vous envoyez trop de messages à la suite !`)] }).catch(()=>null);
        if (warn) setTimeout(() => warn.delete().catch(()=>{}), 2000);
        consecutiveCount.set(uid, 0);
      }
    }

    // ---------------- ANTILINK ----------------
    if (client.antlink && !isOwner(message.author.id) && /(discord\.gg|discordapp\.com\/invite|http:\/\/|https:\/\/)/i.test(content)) {
      await message.delete().catch(()=>{});
      const embed = simpleEmbed("❌ Lien interdit", `${message.author}, les liens sont interdits ici !`);
      const sent = await message.channel.send({ embeds: [embed] }).catch(()=>null);
      if (sent) setTimeout(() => sent.delete().catch(()=>{}), 3000);
      return;
    }

    // store last deleted for snipe (we also handle on messageDelete event)
    if (message.channel) client.snipes.set(message.channel.id, { content: content || "", author: message.author, timestamp: Date.now() });

    if (!content.startsWith('+')) return;
    const args = content.slice(1).trim().split(/ +/).filter(Boolean);
    const command = (args.shift() || "").toLowerCase();

    // ---------- PING ----------
    if (command === 'ping') {
      return message.channel.send("ta cru j’étais mort btrd?").catch(()=>{});
    }

    // ---------- HELP ----------
    if (command === 'help') {
      // Everyone can use +help but it should show only accessible commands -> we'll generate friendly sections like you requested (no emojis)
      const sections = {
        "GÉNÉRAL": [
          { line: "+help : Affiche toutes les commandes (affiche celles auxquelles tu as accès)", show: true },
          { line: "+ping : Test de réponse", show: true },
          { line: "+pic @user | +pic : Photo de profil (tous)", show: true },
          { line: "+banner @user | +banner : Récupère la bannière de la cible (tous)", show: true },
          { line: "+serverpic : Icône du serveur (admin/WL/owner)", show: hasAccess(message.member, "adminwl") },
          { line: "+serverbanner : Bannière du serveur (admin/WL/owner)", show: hasAccess(message.member, "adminwl") }
        ],
        "ROLES": [
          { line: "+addrole @user <roleID> | +delrole @user <roleID> : Gérer rôles (admin/WL/owner)", show: hasAccess(message.member, "adminwl") },
          { line: "+derank @user : Retire tous les rôles (admin/WL/owner)", show: hasAccess(message.member, "adminwl") }
        ],
        "LIMIT ROLES": [
          { line: "+limitrole @role <max> | +unlimitrole @role : Limite/unlimit rôle (WL/owner)", show: hasAccess(message.member, "wl_owner") }
        ],
        "ANTIS": [
          { line: "+antispam | +antibot | +antlink : Toggle anti (admin/WL/owner)", show: hasAccess(message.member, "adminwl") },
          { line: "+antiraid : Toggle anti-raid (owner)", show: hasAccess(message.member, "owner") },
          { line: "+raidlog : Toggle raidlog (admin/WL/owner)", show: hasAccess(message.member, "adminwl") }
        ],
        "MISC": [
          { line: "+clear @user <amount> | +clear <amount> : Supprime messages (admin/WL/owner)", show: hasAccess(message.member, "clear_access") },
          { line: "+slowmode <seconds> : Définit slowmode du salon (admin/WL/owner)", show: hasAccess(message.member, "adminwl") }
        ],
        "DOG SYSTEM": [
          { line: "+dog @user | +undog @user | +undogall | +doglist : Gestion Dog System (owner/Admin/WL)", show: hasAccess(message.member, "owner_admin_wl") }
        ],
        "MOVE / PERM / WAKEUP": [
          { line: "+mv @user | +mv <userID> : Déplacer vers TON vocal (admin/WL/owner/permMv users)", show: hasAccess(message.member, "perm_mv") },
          { line: "+permv @user | +unpermv @user | +permvlist : Gère permv (owner/Admin/WL)", show: hasAccess(message.member, "owner_admin_wl") },
          { line: "+wakeup @user <times> : Déplace la cible dans des vocaux <times> fois et envoie DM - cooldown 5min (owner/Admin/WL)", show: hasAccess(message.member, "owner_admin_wl") }
        ],
        "SNIPE / SNAP": [
          { line: "+snipe : Affiche le dernier message supprimé (auto-supp 3s) (tous)", show: true },
          { line: "+snap @user : DM la cible 5x \"@exec te demande ton snap\" - cooldown 5min (admin/WL/owner)", show: hasAccess(message.member, "adminwl") }
        ],
        "LISTES / MODÉRATION": [
          { line: "+wl @user | +unwl @user | +wlist : Whitelist (owner only)", show: hasAccess(message.member, "owner") },
          { line: "+bl @user | +unbl @user | +blist : Blacklist (admin/WL/owner) - kick si rejoin (3s)", show: hasAccess(message.member, "adminwl") },
          { line: "+ban @user | +unban @user | +banlist : Ban/unban (owner/WL/admin)", show: hasAccess(message.member, "ban_access") },
          { line: "+unbanall : Débannit tous les membres listés (owner only)", show: hasAccess(message.member, "owner") },
          { line: "+wet @user | +unwet @user | +wetlist : Wetlist (owner/WL)", show: hasAccess(message.member, "wet_access") }
        ]
      };

      const descLines = [];
      for (const [section, items] of Object.entries(sections)) {
        const visible = items.some(i => i.show);
        if (!visible) continue;
        descLines.push(`**${section}**`);
        for (const it of items) {
          if (it.show) descLines.push(it.line);
        }
        descLines.push(""); // blank line between sections
      }

      descLines.push(`Owner bot : ${OWNER_ID}`);
      const embed = new EmbedBuilder()
        .setTitle("Liste des commandes")
        .setDescription(descLines.join('\n'))
        .setColor(MAIN_COLOR);
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
        const banner = fetched.bannerURL?.({ size: 1024 });
        if (!banner) return message.reply("Ce membre n'a pas de bannière !");
        const embed = new EmbedBuilder().setTitle(`Bannière de ${u.tag}`).setImage(banner).setColor(MAIN_COLOR);
        return message.channel.send({ embeds: [embed] }).catch(()=>{});
      } catch (e) {
        return message.reply("Erreur lors de la récupération de la bannière.");
      }
    }

    // ---------- SERVER PIC / BANNER ----------
    if (command === 'serverpic') {
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande utilisable uniquement en serveur.");
      const icon = message.guild.iconURL({ dynamic: true, size: 1024 });
      const embed = new EmbedBuilder().setTitle(`${message.guild.name} - icône`).setImage(icon).setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }
    if (command === 'serverbanner') {
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande utilisable uniquement en serveur.");
      const banner = message.guild.bannerURL?.({ size: 1024 });
      if (!banner) return message.reply("Ce serveur n'a pas de bannière !");
      const embed = new EmbedBuilder().setTitle(`${message.guild.name} - bannière`).setImage(banner).setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }

    // ---------- ROLE MANAGEMENT ----------
    if (command === 'addrole') {
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      const roleArg = args[0] || args[1];
      const role = message.mentions.roles.first() || parseRoleArg(message.guild, roleArg) || message.guild.roles.cache.get(roleArg);
      if (!member || !role) return message.reply("Usage: +addrole @user <roleID>");
      const limit = client.limitRoles.get(role.id);
      if (limit && role.members.size >= limit) return message.reply(`❌ Le rôle ${role.name} a atteint sa limite (${limit}).`);
      await member.roles.add(role).catch(()=>message.reply("❌ Impossible d'ajouter le rôle (vérifie mes permissions)."));
      return message.channel.send(`✅ ${member.user.tag} a reçu le rôle ${role.name}`);
    }
    if (command === 'delrole') {
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      const roleArg = args[0] || args[1];
      const role = message.mentions.roles.first() || parseRoleArg(message.guild, roleArg) || message.guild.roles.cache.get(roleArg);
      if (!member || !role) return message.reply("Usage: +delrole @user <roleID>");
      await member.roles.remove(role).catch(()=>message.reply("❌ Impossible de retirer le rôle (vérifie mes permissions)."));
      return message.channel.send(`✅ ${member.user.tag} a perdu le rôle ${role.name}`);
    }
    if (command === 'derank') {
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      await member.roles.set([]).catch(()=>message.reply("❌ Impossible de modifier les rôles."));
      return message.channel.send(`✅ ${member.user.tag} a été déranké !`);
    }

    // ---------- LIMIT ROLE ----------
    if (command === 'limitrole') {
      if (!hasAccess(message.member, "wl_owner")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const role = message.mentions.roles.first() || parseRoleArg(message.guild, args[0]);
      const max = parseInt(args[1] || args[0]);
      if (!role || isNaN(max) || max < 1) return message.reply("❌ Usage: +limitrole @role <max>");
      client.limitRoles.set(role.id, max);
      persistAll();
      return message.channel.send(`✅ Limite du rôle ${role.name} définie à ${max} membres !`);
    }
    if (command === 'unlimitrole' || command === 'unlimiterole') {
      if (!hasAccess(message.member, "wl_owner")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const role = message.mentions.roles.first() || parseRoleArg(message.guild, args[0]);
      if (!role) return message.reply("❌ Usage: +unlimitrole @role");
      client.limitRoles.delete(role.id);
      persistAll();
      return message.channel.send(`✅ Limite du rôle ${role.name} supprimée !`);
    }

    // ---------- ANT TOGGLES ----------
    if (['antibot','antispam','antlink','antiraid','raidlog'].includes(command)) {
      if (command === 'antiraid' && !isOwner(message.author.id)) return sendNoAccess(message);
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      client[command] = !client[command];
      return message.channel.send(`✅ ${command} ${client[command] ? "activé" : "désactivé"} !`);
    }

    // ---------- SLOWMODE ----------
    if (command === 'slowmode') {
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const seconds = parseInt(args[0]);
      if (isNaN(seconds) || seconds < 0 || seconds > 21600) return message.reply("❌ Donne un nombre entre 0 et 21600 (secondes).");
      message.channel.setRateLimitPerUser(seconds).then(() => {
        message.channel.send(`✅ Slowmode défini à ${seconds}s pour ce salon.`).then(m => setTimeout(() => m.delete().catch(()=>{}), 5000));
      }).catch(() => message.reply("❌ Impossible de modifier le slowmode (vérifie mes permissions)."));
      return;
    }

    // ---------- SNIPE ----------
    if (command === 'snipe') {
      const snipe = client.snipes.get(message.channel.id);
      if (!snipe) return message.reply("❌ Aucun message à snipe !");
      const date = new Date(snipe.timestamp || Date.now());
      const embed = new EmbedBuilder()
        .setAuthor({ name: snipe.author.tag, iconURL: snipe.author.displayAvatarURL?.({ dynamic: true }) })
        .setDescription(snipe.content)
        .addFields({ name: "Supprimé le", value: `${date.toLocaleString()}`, inline: true })
        .setColor(MAIN_COLOR);
      const sent = await message.channel.send({ embeds: [embed] }).catch(()=>null);
      if (sent) setTimeout(() => sent.delete().catch(()=>{}), 3000); // auto-delete 3s
      return;
    }

    // ---------- CLEAR ----------
    if (command === 'clear') {
      if (!hasAccess(message.member, "clear_access")) return sendNoAccess(message);
      if (!message.channel) return;
      let target = message.mentions.users.first();
      let amount = 0;
      if (target) {
        amount = parseInt(args[1]) || parseInt(args[0]) || 50;
      } else {
        const possibleId = args[0];
        if (possibleId && /^\d{17,19}$/.test(possibleId)) {
          target = await client.users.fetch(possibleId).catch(()=>null);
          amount = parseInt(args[1]) || 50;
        } else {
          amount = parseInt(args[0]) || 50;
        }
      }
      if (amount < 1 || amount > 100) return message.reply("❌ Donne un nombre entre 1 et 100 !");
      try {
        const fetched = await message.channel.messages.fetch({ limit: 100 });
        let messagesToDelete;
        if (target) {
          messagesToDelete = fetched.filter(m => m.author.id === target.id).first(amount);
        } else {
          messagesToDelete = fetched.first(amount);
        }
        await message.channel.bulkDelete(messagesToDelete, true).catch(()=>{});
        const info = await message.channel.send({ embeds: [simpleEmbed("✅ Messages supprimés", `${target ? `${amount} messages de ${target.tag} supprimés` : `${amount} messages supprimés`}`)] });
        setTimeout(() => info.delete().catch(()=>{}), 3000);
      } catch (err) {
        console.error("clear error:", err);
        message.channel.send("❌ Une erreur est survenue lors de la suppression des messages.");
      }
      return;
    }

    // ---------- DOG SYSTEM ----------
    if (command === 'dog') {
      if (!hasAccess(message.member, "owner_admin_wl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      if (member.id === message.author.id) return message.reply("❌ Tu ne peux pas te mettre toi-même en dog !");
      if (client.dogs.has(member.id)) return message.reply("❌ Ce membre est déjà en laisse !");
      const dogsOfMaster = [...client.dogs.values()].filter(m => m === message.author.id);
      const maxDogs = isAdminMember(message.member) ? 10 : 2;
      if (dogsOfMaster.length >= maxDogs) return message.reply(`❌ Tu ne peux pas avoir plus de ${maxDogs} dogs !`);
      client.dogs.set(member.id, message.author.id);
      persistAll();
      try { await member.setNickname(`🦮${message.member.displayName}`).catch(()=>{}); } catch {}
      try { if (member.voice.channel && message.member.voice.channel) await member.voice.setChannel(message.member.voice.channel).catch(()=>{}); } catch {}
      return message.channel.send(`✅ ${member.displayName} est maintenant en laisse par ${message.member.displayName} !`);
    }
    if (command === 'undog') {
      if (!hasAccess(message.member, "owner_admin_wl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      if (!client.dogs.has(member.id)) return message.reply("❌ Ce membre n'est pas en laisse !");
      if (client.dogs.get(member.id) !== message.author.id && !isAdminMember(message.member) && !isOwner(message.author.id)) return message.reply("❌ Tu n'es pas le maître de ce dog !");
      client.dogs.delete(member.id);
      persistAll();
      member.setNickname(null).catch(()=>{});
      return message.channel.send(`✅ ${member.displayName} a été libéré par ${message.member.displayName} !`);
    }
    if (command === 'undogall') {
      if (!hasAccess(message.member, "owner_admin_wl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      client.dogs.forEach((masterId, dogId) => {
        const dog = message.guild.members.cache.get(dogId);
        if (dog) dog.setNickname(null).catch(()=>{});
      });
      client.dogs.clear();
      persistAll();
      return message.channel.send("✅ Tous les dogs ont été libérés !");
    }
    if (command === 'doglist') {
      if (!hasAccess(message.member, "owner_admin_wl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      if (client.dogs.size === 0) return message.reply("❌ Aucun dog enregistré !");
      const list = [...client.dogs.entries()].map(([dogId, masterId]) => {
        const dog = message.guild.members.cache.get(dogId);
        const master = message.guild.members.cache.get(masterId);
        return `${dog ? dog.displayName : dogId} -> ${master ? master.displayName : masterId}`;
      }).join("\n");
      return message.channel.send(`🦮 Liste des dogs :\n${list}`);
    }

    // ---------- MV / PERMV ----------
    if (command === 'mv') {
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const target = message.mentions.members.first() || (args[0] && message.guild.members.cache.get(args[0]));
      if (!target) return message.reply("❌ Membre introuvable !");
      if (!target.voice.channel) return message.reply("❌ Cet utilisateur n'est pas en vocal !");
      if (!message.member.voice.channel) return message.reply("❌ Tu dois être en vocal !");
      if (!hasAccess(message.member, "perm_mv")) return sendNoAccess(message);
      await target.voice.setChannel(message.member.voice.channel).catch(()=>{});
      return message.channel.send(`✅ ${target.displayName} déplacé dans ton channel vocal !`);
    }
    if (command === 'permv') {
      if (!hasAccess(message.member, "owner_admin_wl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.permMvUsers.add(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.displayName} peut désormais utiliser +mv !`);
    }
    if (command === 'unpermv') {
      if (!hasAccess(message.member, "owner_admin_wl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.permMvUsers.delete(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.displayName} ne peut plus utiliser +mv !`);
    }
    if (['permvlist','permmvlist','permmv'].includes(command)) {
      if (!hasAccess(message.member, "owner_admin_wl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      if (client.permMvUsers.size === 0) return message.reply("❌ Aucun membre autorisé à +mv !");
      const list = [...client.permMvUsers].map(id => {
        const m = message.guild.members.cache.get(id);
        return m ? m.displayName : id;
      }).join("\n");
      return message.channel.send(`✅ Membres autorisés à +mv :\n${list}`);
    }

    // ---------- WAKEUP ----------
    if (command === 'wakeup') {
      if (!hasAccess(message.member, "owner_admin_wl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande en serveur uniquement.");
      const target = message.mentions.members.first() || (args[0] && message.guild.members.cache.get(args[0]));
      let times = parseInt(args[1] || args[0 + 1]) || 0;
      if (!target) return message.reply("❌ Mentionnez un membre !");
      if (!target.voice.channel) return message.reply("❌ Cet utilisateur n'est pas en vocal !");
      if (!times || times < 1) return message.reply("❌ Donne un nombre de réveils entre 1 et 150 !");
      times = Math.min(times, 150);
      const executorId = message.author.id;

      // cooldown check (persisted). owner immune to cooldown
      if (!isOwner(executorId) && isOnPersistentCooldown('wakeup', executorId)) {
        const until = persistentCooldowns['wakeup'][executorId];
        const remain = Math.ceil((until - Date.now()) / 1000);
        return message.reply(`⏳ Attends ${remain} secondes avant de refaire +wakeup !`);
      }
      if (client.wakeupInProgress.has(target.id)) return message.reply("❌ Un wakeup est déjà en cours pour cette cible.");
      client.wakeupInProgress.add(target.id);
      if (!isOwner(executorId)) setPersistentCooldown('wakeup', executorId, 5 * 60 * 1000);

      const voiceChannels = message.guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice && c.viewable).map(c => c);
      if (voiceChannels.length < 1) {
        client.wakeupInProgress.delete(target.id);
        return message.reply("❌ Aucun channel vocal disponible pour faire le wakeup.");
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
        client.wakeupInProgress.delete(target.id);
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
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      if (!message.guild) return message.reply("Commande utilisable uniquement en serveur.");
      const target = message.mentions.members.first();
      if (!target) return message.reply("❌ Mentionnez un membre !");
      const executorId = message.author.id;

      // cooldown check (persisted). owner immune to cooldown
      if (!isOwner(executorId) && isOnPersistentCooldown('snap', executorId)) {
        const until = persistentCooldowns['snap'][executorId];
        const remain = Math.ceil((until - Date.now()) / 1000);
        return message.reply(`⏳ Attends ${remain} secondes avant de refaire +snap !`);
      }

      // send 5 DMs to target
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
    if (command === 'wl' || command === 'addwl') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.whitelist.add(member.id);
      persistAll();
      return message.channel.send(`✅ ${member} ajouté à la whitelist !`);
    }
    if (command === 'unwl' || command === 'delwl') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.whitelist.delete(member.id);
      persistAll();
      return message.channel.send(`✅ ${member} retiré de la whitelist !`);
    }
    if (command === 'wlist' || command === 'whitelist') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      if (client.whitelist.size === 0) return message.reply("❌ La whitelist est vide !");
      const mentions = [...client.whitelist].map(id => `<@${id}>`).join('\n');
      return message.channel.send(`✅ Membres whitelist :\n${mentions}`);
    }

    // ---------- BLACKLIST ----------
    if (command === 'bl' || command === 'addbl') {
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      if (member.id === OWNER_ID || client.whitelist.has(member.id)) return message.reply("❌ Impossible d'ajouter ce membre à la blacklist (protection owner / whitelist).");
      client.blacklist.add(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.user.tag} ajouté à la blacklist ! (sera kick si rejoint)`);
    }
    if (command === 'unbl' || command === 'delbl') {
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.blacklist.delete(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.user.tag} retiré de la blacklist !`);
    }
    if (command === 'blist' || command === 'blacklist') {
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      if (client.blacklist.size === 0) return message.reply("❌ La blacklist est vide !");
      const list = [...client.blacklist].map(id => {
        const m = message.guild?.members.cache.get(id);
        return m ? m.user.tag : id;
      }).join("\n");
      return message.channel.send(`❌ Membres blacklist :\n${list}`);
    }

    // ---------- BAN / UNBAN ----------
    if (command === 'ban') {
      if (!hasAccess(message.member, "ban_access")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      if (member.id === OWNER_ID || client.whitelist.has(member.id)) return message.reply("❌ Impossible de bannir ce membre (protection owner / whitelist).");
      client.banList.add(member.id);
      persistAll();
      await member.ban({ reason: "Ban command" }).catch(()=>{});
      return message.channel.send(`✅ ${member.user.tag} a été banni !`);
    }
    if (command === 'unban') {
      if (!hasAccess(message.member, "ban_access")) return sendNoAccess(message);
      const user = message.mentions.users.first() || (args[0] && await client.users.fetch(args[0]).catch(()=>null));
      if (!user) return message.reply("❌ Mentionnez un utilisateur !");
      client.banList.delete(user.id);
      persistAll();
      message.guild.members.unban(user.id).catch(()=>{});
      return message.channel.send(`✅ ${user.tag} a été débanni !`);
    }
    if (command === 'banlist') {
      if (!hasAccess(message.member, "ban_access")) return sendNoAccess(message);
      if (client.banList.size === 0) return message.reply("❌ Aucun membre banni !");
      const list = [...client.banList].map(id => {
        const u = client.users.cache.get(id);
        return u ? u.tag : id;
      }).join("\n");
      return message.channel.send(`⚠️ Liste des bannis :\n${list}`);
    }
    if (command === 'unbanall') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      for (const id of [...client.banList]) {
        try { await message.guild.members.unban(id); } catch {}
        client.banList.delete(id);
      }
      persistAll();
      return message.channel.send("✅ Tentative de débannir tous les membres de la banList.");
    }

    // ---------- WET ----------
    if (command === 'wet') {
      if (!hasAccess(message.member, "wet_access")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      if (member.id === OWNER_ID || client.whitelist.has(member.id)) return message.reply("❌ Impossible de wet ce membre (protection owner / whitelist).");
      if (client.wetList.has(member.id)) return message.reply("❌ Ce membre est déjà wet !");
      client.wetList.add(member.id);
      persistAll();
      await member.ban({ reason: "Wet ban" }).catch(()=>{});
      return message.channel.send(`⚠️ ${member.user.tag} a été wet (banni) !`);
    }
    if (command === 'unwet') {
      if (!hasAccess(message.member, "wet_access")) return sendNoAccess(message);
      const user = message.mentions.users.first();
      if (!user) return message.reply("❌ Mentionnez un utilisateur !");
      if (!client.wetList.has(user.id)) return message.reply("❌ Ce membre n'a pas été wet !");
      client.wetList.delete(user.id);
      persistAll();
      message.guild.members.unban(user.id).catch(()=>{});
      return message.channel.send(`✅ ${user.tag} a été dé-wet !`);
    }
    if (command === 'wetlist') {
      if (!hasAccess(message.member, "wet_access")) return sendNoAccess(message);
      if (client.wetList.size === 0) return message.reply("❌ Aucun membre wet !");
      const list = [...client.wetList].map(id => {
        const u = client.users.cache.get(id);
        return u ? u.tag : id;
      }).join("\n");
      return message.channel.send(`⚠️ Membres wet :\n${list}`);
    }

    // ---------- LOCKNAME ----------
    if (command === 'lockname') {
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.lockedNames.add(member.id);
      persistAll();
      return message.channel.send(`🔒 Le pseudo de ${member.displayName} est maintenant verrouillé !`);
    }
    if (command === 'unlockname') {
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.lockedNames.delete(member.id);
      persistAll();
      return message.channel.send(`🔓 Le pseudo de ${member.displayName} est maintenant déverrouillé !`);
    }
    if (command === 'locknamelist') {
      if (!hasAccess(message.member, "adminwl")) return sendNoAccess(message);
      if (client.lockedNames.size === 0) return message.reply("❌ Aucun pseudo n'est verrouillé !");
      const list = [...client.lockedNames].map(id => {
        const m = message.guild.members.cache.get(id);
        return m ? m.displayName : id;
      }).join("\n");
      return message.channel.send(`🔒 Pseudos verrouillés :\n${list}`);
    }

    // ---------- ADMIN CUSTOM (+admin, +unadmin, +adminlist) ----------
    if (command === 'admin') {
      if (!ownerOrWLOnly(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.adminUsers.add(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.user.tag} a reçu la permission admin (via +admin).`);
    }
    if (command === 'unadmin' || command === 'deladmin') {
      if (!ownerOrWLOnly(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
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

    // done - if no command matched, ignore
    return;

  } catch (err) {
    console.error("Erreur gestion message:", err);
    try { await message.reply("❌ Une erreur est survenue lors du traitement de la commande."); } catch {}
  }
});

// -------------------- READY --------------------
client.on("clientReady", () => {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);
});
// --------------------Graceful shutdown--------------------
process.on('SIGINT', () => { console.log("SIGINT reçu, sauvegarde..."); persistAll(); process.exit(); });
process.on('beforeExit', () => { persistAll(); });

// -------------------- LOGIN --------------------
const token = process.env.TOKEN || process.env.TOKEN_DISCORD || process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ Aucun token trouvé. Ajoute ton token dans .env sous TOKEN=");
  process.exit(1);
}
client.login(token).then(() => console.log("✅ Bot login success.")).catch(err => console.error("❌ Erreur de connexion :", err));
