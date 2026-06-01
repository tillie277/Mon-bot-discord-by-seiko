require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType, ActivityType, joinVoiceChannel } = require('discord.js');

// ====================== CONFIG ======================
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "685679698054742017"; // Mis à jour comme demandé
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
  inviteLogger: path.join(DATA_DIR, 'inviteLogger.json'),
  ghostJoins: path.join(DATA_DIR, 'ghostJoins.json'),
  fabulousUsers: path.join(DATA_DIR, 'fabulousUsers.json'),
  permAddRole: path.join(DATA_DIR, 'permAddRole.json'),
  permImageRoles: path.join(DATA_DIR, 'permImageRoles.json'),
  smashChannels: path.join(DATA_DIR, 'smashChannels.json'),
  welcomeConfig: path.join(DATA_DIR, 'welcomeConfig.json'),
  backup: path.join(DATA_DIR, 'backup.json'),
  autorole: path.join(DATA_DIR, 'autorole.json'),
  roleLocks: path.join(DATA_DIR, 'roleLocks.json'),     // Nouveau
  ultraLock: path.join(DATA_DIR, 'ultraLock.json')      // Nouveau
};

const PORT = process.env.PORT || 10000;
const EXTERNAL_PING_URL = "https://mon-bot-discord-by-seiko.onrender.com/";

// ====================== CLIENT ======================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildPresences
  ]
});

// ====================== DATA ======================
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
client.inviteLoggerChannel = null;
client.ghostJoinsChannel = null;
client.fabulousUsers = new Set();
client.permAddRole = new Map();
client.permImageRoles = new Set();
client.smashChannels = new Set();
client.welcomeConfig = new Map();
client.jailRoleId = null;
client.autorole = null;
client.antiRaid = false;
client.roleLocks = new Map();   // roleId → lockerId
client.ultraLock = false;       // Mode ultra lock global

let persistentCooldowns = {};

// ====================== JSON UTILS ======================
const readJSONSafe = (p) => {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { return null; }
};

const writeJSONSafe = (p, data) => {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch (e) {}
};

// ====================== PERSISTENCE ======================
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

  const pvObj = {};
  client.pvChannels.forEach((v, k) => pvObj[k] = { allowed: [...v.allowed], ownerId: v.ownerId || null });
  writeJSONSafe(PATHS.pv, pvObj);

  writeJSONSafe(PATHS.lockedTextChannels, [...client.lockedTextChannels]);
  writeJSONSafe(PATHS.inviteLogger, client.inviteLoggerChannel);
  writeJSONSafe(PATHS.ghostJoins, client.ghostJoinsChannel);
  writeJSONSafe(PATHS.fabulousUsers, [...client.fabulousUsers]);
  writeJSONSafe(PATHS.permAddRole, [...client.permAddRole.entries()]);
  writeJSONSafe(PATHS.permImageRoles, [...client.permImageRoles]);
  writeJSONSafe(PATHS.smashChannels, [...client.smashChannels]);
  writeJSONSafe(PATHS.welcomeConfig, Object.fromEntries(client.welcomeConfig));
  writeJSONSafe(PATHS.backup, { jailRoleId: client.jailRoleId, antiRaid: client.antiRaid });
  writeJSONSafe(PATHS.autorole, client.autorole);
  writeJSONSafe(PATHS.roleLocks, Object.fromEntries(client.roleLocks));   // Nouveau
  writeJSONSafe(PATHS.ultraLock, client.ultraLock);                       // Nouveau
}

function loadAll() {
  // ... (tout le load existant reste identique)
  const wl = readJSONSafe(PATHS.whitelist); if (Array.isArray(wl)) wl.forEach(id => client.whitelist.add(id));
  const adm = readJSONSafe(PATHS.admin); if (Array.isArray(adm)) adm.forEach(id => client.adminUsers.add(id));
  const bl = readJSONSafe(PATHS.blacklist); if (Array.isArray(bl)) bl.forEach(id => client.blacklist.add(id));
  const wet = readJSONSafe(PATHS.wetList); if (Array.isArray(wet)) wet.forEach(id => client.wetList.add(id));
  const ban = readJSONSafe(PATHS.banList); if (Array.isArray(ban)) ban.forEach(id => client.banList.add(id));
  const dogs = readJSONSafe(PATHS.dogs); if (Array.isArray(dogs)) dogs.forEach(([k, v]) => client.dogs.set(k, v));
  const pmv = readJSONSafe(PATHS.permMv); if (Array.isArray(pmv)) pmv.forEach(id => client.permMvUsers.add(id));
  const lr = readJSONSafe(PATHS.limitRoles); if (Array.isArray(lr)) lr.forEach(([k, v]) => client.limitRoles.set(k, v));
  const ln = readJSONSafe(PATHS.lockedNames); if (Array.isArray(ln)) ln.forEach(id => client.lockedNames.add(id));
  const cds = readJSONSafe(PATHS.cooldowns); if (cds) persistentCooldowns = cds;
  const pv = readJSONSafe(PATHS.pv); if (pv) Object.entries(pv).forEach(([k, v]) => client.pvChannels.set(k, { allowed: new Set(v.allowed || []), ownerId: v.ownerId || null }));
  const lockedTxt = readJSONSafe(PATHS.lockedTextChannels); if (Array.isArray(lockedTxt)) lockedTxt.forEach(id => client.lockedTextChannels.add(id));
  client.inviteLoggerChannel = readJSONSafe(PATHS.inviteLogger);
  client.ghostJoinsChannel = readJSONSafe(PATHS.ghostJoins);
  const fab = readJSONSafe(PATHS.fabulousUsers); if (Array.isArray(fab)) fab.forEach(id => client.fabulousUsers.add(id));
  const permAdd = readJSONSafe(PATHS.permAddRole); if (Array.isArray(permAdd)) permAdd.forEach(([k, v]) => client.permAddRole.set(k, v));
  const permImg = readJSONSafe(PATHS.permImageRoles); if (Array.isArray(permImg)) permImg.forEach(id => client.permImageRoles.add(id));
  const smash = readJSONSafe(PATHS.smashChannels); if (Array.isArray(smash)) smash.forEach(id => client.smashChannels.add(id));
  const welcomeData = readJSONSafe(PATHS.welcomeConfig); if (welcomeData) client.welcomeConfig = new Map(Object.entries(welcomeData));
  const backupData = readJSONSafe(PATHS.backup);
  if (backupData) {
    client.jailRoleId = backupData.jailRoleId || null;
    client.antiRaid = backupData.antiRaid ?? false;
  }
  client.autorole = readJSONSafe(PATHS.autorole) || null;

  // Nouveau
  const roleLocksData = readJSONSafe(PATHS.roleLocks);
  if (roleLocksData) client.roleLocks = new Map(Object.entries(roleLocksData));
  client.ultraLock = readJSONSafe(PATHS.ultraLock) ?? false;
}

// ====================== PERMISSIONS ======================
const isOwner = (id) => id === OWNER_ID;
const isWL = (id) => client.whitelist.has(id) || isOwner(id);
const isAdmin = (member) => member?.permissions?.has(PermissionsBitField.Flags.Administrator) || client.adminUsers.has(member?.id);

const hasAccess = (member, level) => {
  if (!member) return false;
  const id = member.id;
  if (level === "owner") return isOwner(id);
  if (level === "wl") return isWL(id);
  if (level === "admin") return isAdmin(member) || isWL(id) || isOwner(id);
  if (level === "everyone") return true;
  return false;
};

const hasPermImage = (member) => {
  if (!member) return false;
  return [...member.roles.cache.keys()].some(roleId => client.permImageRoles.has(roleId));
};

// ====================== HELPERS ======================
function getStatusAndPlatform(member) {
  if (!member.presence) return { status: "⚫ Hors ligne", platform: "Inconnu" };
  const statusMap = { online: "🟢 En ligne", idle: "🟡 Inactif", dnd: "🔴 Ne pas déranger", offline: "⚫ Hors ligne" };
  let statusText = statusMap[member.presence.status] || "⚫ Hors ligne";
  let platform = "Inconnu";
  if (member.presence.clientStatus) {
    if (member.presence.clientStatus.mobile) platform = "Mobile";
    else if (member.presence.clientStatus.desktop) platform = "Ordinateur";
    else if (member.presence.clientStatus.web) platform = "Web";
  }
  return { status: statusText, platform };
}

function getRandomVoiceChannel(guild, excludeId = null) {
  const voices = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice && c.id !== excludeId && c.viewable);
  return voices.size > 0 ? voices.random() : null;
}

async function ensureLogChannels(guild) {
  const names = ['messages-logs', 'boost-logs', 'commande-logs'];
  const out = {};
  for (const name of names) {
    let ch = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildText);
    if (!ch) ch = await guild.channels.create({ name, type: ChannelType.GuildText, reason: 'Logs par bot Seiko' }).catch(() => null);
    out[name.replace('-logs', '')] = ch;
  }
  return out;
}

// ====================== EVENTS ======================
client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member;
  if (!member || member.user.bot) return;

  // Ultra Lock
  if (client.ultraLock && newState.channel && !isOwner(member.id)) {
    await member.voice.disconnect().catch(() => {});
    member.send("on est entrain de sexcall casse toi fdp").catch(() => {});
    return;
  }

  // Dog system (ancien)
  client.dogs.forEach((info, dogId) => {
    if (info.executorId === member.id && newState.channel) {
      const dog = newState.guild.members.cache.get(dogId);
      if (dog && dog.voice.channel?.id !== newState.channel.id) {
        dog.voice.setChannel(newState.channel).catch(() => {});
      }
    }
  });
});

client.on('messageDelete', async message => { /* ... reste identique ... */ });

client.on('guildMemberAdd', async member => { /* ... reste identique ... */ });

client.on('guildMemberRemove', async member => { /* ... reste identique ... */ });

client.on('guildMemberUpdate', async (oldMember, newMember) => { /* ... reste identique ... */ });

// ====================== KEEP ALIVE ======================
http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Bot is alive - Seiko Edition'); }).listen(PORT, '0.0.0.0', () => console.log(`✅ Keep-alive on port ${PORT}`));
setInterval(() => { try { https.get(EXTERNAL_PING_URL).on('error', () => {}); } catch (e) {} }, 300000);

// ====================== MESSAGE CREATE ======================
client.on('messageCreate', async message => {
  // Restriction GIF (identique)
  if (!message.author.bot) {
    const hasImagePerm = hasPermImage(message.member);
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const urls = message.content.match(urlRegex) || [];
    let hasNonGifLink = urls.some(url => !url.toLowerCase().endsWith('.gif'));
    const hasGifAttachment = message.attachments.some(att => att.contentType?.includes('image/gif') || att.url.toLowerCase().endsWith('.gif'));

    if (hasNonGifLink && !hasGifAttachment && !hasImagePerm) {
      await message.delete().catch(() => {});
      return message.channel.send(`❌ <@${message.author.id}> seuls les liens **GIF** sont autorisés.`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }
  }

  // Smash mode (identique)
  if (client.smashChannels.has(message.channel.id) && !message.author.bot) {
    const hasMedia = message.attachments.some(a => a.contentType?.startsWith('image') || a.contentType?.startsWith('video'));
    if (!hasMedia) return message.delete().catch(() => {});
    await message.react('✅').catch(() => {});
    await message.react('❌').catch(() => {});
    message.startThread({ name: "Avis smash/pass", autoArchiveDuration: 1440 }).catch(() => {});
  }

  // Mention bot (identique)
  if (message.mentions.has(client.user) && !message.author.bot) {
    return message.reply(message.author.id === OWNER_ID ? "salut boss je suis la prêt à tout 🔥" : "ftg sale grosse keh reste a ta place d’excrément.");
  }

  if (!message.content.startsWith('+') || message.author.bot) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const authorId = message.author.id;
  const member = message.member;

  const logs = await ensureLogChannels(message.guild);
  if (logs.commande) logs.commande.send(`📌 **${message.author.tag}** a utilisé : \`${message.content}\``).catch(() => {});

  // ==================== NOUVELLES COMMANDES ====================

  if (cmd === 'rolelock') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
    if (!role) return message.reply("❌ Mentionne un rôle ou donne son ID.");
    client.roleLocks.set(role.id, authorId);
    persistAll();
    return message.channel.send(`✅ Rôle **${role.name}** verrouillé par <@${authorId}>.`);
  }

  if (cmd === 'roleunlock') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
    if (!role) return message.reply("❌ Mentionne un rôle ou donne son ID.");
    if (!client.roleLocks.has(role.id)) return message.reply("❌ Ce rôle n'est pas verrouillé.");
    client.roleLocks.delete(role.id);
    persistAll();
    return message.channel.send(`✅ Verrouillage du rôle **${role.name}** retiré.`);
  }

  if (cmd === 'lockultra') {
    if (!isOwner(authorId)) return message.reply("❌ Seul Owner.");
    client.ultraLock = !client.ultraLock;
    persistAll();
    return message.channel.send(`🚨 Ultra Lock **${client.ultraLock ? 'activé' : 'désactivé'}**. Personne sauf l'owner ne peut rejoindre les vocaux.`);
  }

  // ==================== COMMANDES EXISTANTES (inchangées) ====================

  if (cmd === 'help') {
    const embed = new EmbedBuilder().setTitle("📜 Commandes Seiko Bot").setColor(MAIN_COLOR).setDescription(
      `**Général**\n` +
      `+pic @user → Photo de profil\n` +
      `+banner @user → Bannière\n` +
      `+ui @user → Infos utilisateur\n` +
      `+snipe → Dernier message supprimé\n\n` +
      `**Modération**\n` +
      `+lock / +unlock → Verrouille/déverrouille salon\n` +
      `+clear @user <nb> → Supprime messages\n` +
      `+slowmode <secondes> → Mode lent\n` +
      `+derank @user → Dé-rank\n` +
      `+addrole @user @role → Ajoute rôle\n` +
      `+delrole @user @role → Retire rôle\n` +
      `+rolemembers @role → Liste membres du rôle\n` +
      `+jail @user → Jail\n` +
      `+unjail @user → Libère jail\n` +
      `+antiraid → Anti-raid puissant\n` +
      `+limitrole @role <max> → Limite rôle\n` +
      `+permimage @role → Autorise liens normaux\n` +
      `+rolelock @role → Verrouille un rôle\n` +
      `+roleunlock @role → Déverrouille un rôle\n\n` +
      `**Fun / Utilitaires**\n` +
      `+dog @user → Dog + follow vocal\n` +
      `+undog @user / +undogall → Libère\n` +
      `+wet @user → Wet ban spécial\n` +
      `+unwet @user → Dé-wet\n` +
      `+bl @user / +unbl @user → Blacklist\n` +
      `+smash → Mode smash (images/vidéos only)\n` +
      `+fabulousbot @user → Fabulousbot\n` +
      `+wakeup @user <times> → Réveille\n` +
      `+snap @user → Demande snap\n` +
      `+flood ID @user <10> → Spam\n` +
      `+say ID <message> → Envoie dans salon\n` +
      `+delchannel ID → Supprime salon\n` +
      `+permmv @role → Perm +mv\n` +
      `+mv @user → Déplace en vocal\n` +
      `+Permaddrole @role <count> → Perm +addrole\n` +
      `+delpermaddrole @role → Retire perm +addrole\n\n` +
      `**Owner / WL**\n` +
      `+wl @user → Whitelist\n` +
      `+admin @user → Admin bot\n` +
      `+dmall <message> → MP tout le serveur\n` +
      `+mybotserv → Liste serveurs\n` +
      `+joinsbot ID → Bot rejoint vocal\n` +
      `+backup save/load → Backup rôles\n` +
      `+invitelogger → Active logger\n` +
      `+ghostjoins ID → Ghost joins\n` +
      `+unbanall → Débannit tout\n` +
      `+mutealls → Mute tout le vocal\n` +
      `+randomvoc → Déplace aléatoirement\n` +
      `+lockultra → Ultra lock vocal\n` +
      `+ping → Test\n`
    );
    return message.channel.send({ embeds: [embed] });
  }

  // ==================== ADDROLE MODIFIÉ ====================
  if (cmd === 'addrole') {
    const hasPermAdd = [...member.roles.cache.keys()].some(rid => client.permAddRole.has(rid));
    if (!hasAccess(member, "admin") && !hasPermAdd) return message.reply("❌ Accès refusé.");

    const target = message.mentions.members.first();
    const role = message.mentions.roles.first();
    if (!target || !role) return message.reply("❌ @user @role");

    // Vérification rolelock
    if (client.roleLocks.has(role.id)) {
      const lockerId = client.roleLocks.get(role.id);
      if (lockerId !== authorId && !isOwner(authorId)) {
        member.send("c’est pas ton role fdp l’ajoute pas a ta pute").catch(() => {});
        return message.reply("❌ Tu ne peux pas ajouter ce rôle verrouillé.");
      }
    }

    await target.roles.add(role).catch(() => {});
    return message.channel.send(`✅ Rôle ajouté à ${target}.`);
  }

  // Toutes les autres commandes restent exactement comme avant (delrole, pic, banner, etc.)
  // ... [Le reste du bloc if(cmd === ...) est identique à ton code original]

  if (cmd === 'delrole') { /* identique */ }
  if (cmd === 'ping') return message.channel.send("ta cru jt off btrd?");
  if (cmd === 'jail') { /* identique */ }
  if (cmd === 'unjail') { /* identique */ }
  // ... (toutes les autres commandes jusqu'à la fin)

  message.reply("❌ Commande inconnue. Tape `+help` pour tout voir.");
});

// ====================== READY ======================
client.once('ready', () => {
  console.log(`✅ SEIKO BOT CONNECTÉ : ${client.user.tag} | ${client.guilds.cache.size} serveurs`);
  client.user.setActivity({ name: 'seïko votre Rois 👑', type: ActivityType.Streaming, url: 'https://www.twitch.tv/discord' });
});

loadAll();
setInterval(persistAll, 60000);

const token = process.env.TOKEN;
if (!token) { console.error("❌ TOKEN manquant dans .env"); process.exit(1); }

client.login(token)
  .then(() => console.log("✅ Login réussi - Seiko Bot prêt !"))
  .catch(err => console.error("❌ Login error :", err));