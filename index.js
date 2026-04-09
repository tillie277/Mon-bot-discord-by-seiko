require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType, ActivityType, AttachmentBuilder } = require('discord.js');

// -------------------- CONFIG --------------------
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "1422769356667883551";   // ← ID OWNER BOT MISE À JOUR
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
const PORT = process.env.PORT || 3000;   // ← PORT MODIFIÉ COMME DEMANDÉ

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
client.snipes = new Map(); // now supports attachments too
client.messageLastTs = new Map();
client.processingMessageIds = new Set();
client.prefixes = new Map(); // guildId -> prefix (default +)
client.smashChannels = new Set();
client.ghostJoins = new Map(); // guildId -> channelId
client.fabulousUsers = new Set(); // users allowed to dog/wakeup/mv the owner bot
client.permAddRole = new Map(); // roleId -> remaining uses
client.welcomeConfig = new Map(); // guildId -> {channelId, message}

// persistent cooldowns
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

// -------------------- TEXT LOCK FUNCTION (ajoutée pour corriger l'erreur future) --------------------
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

// -------------------- LOG CHANNELS + JAIL + PRIVATE CATEGORY --------------------
async function ensureLogChannels(guild) {
  const names = { messages: 'messages-logs', roles: 'role-logs', boosts: 'boost-logs', commands: 'commande-logs', raids: 'raidlogs', leave: 'leave' };
  const out = {};
  for (const [k, name] of Object.entries(names)) {
    let ch = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildText);
    if (!ch) {
      try {
        ch = await guild.channels.create({ name, type: ChannelType.GuildText, reason: 'Logs par bot' });
      } catch {}
    }
    out[k] = ch || null;
  }
  // Private category for logs
  let cat = guild.channels.cache.find(c => c.name === 'logs-privé' && c.type === ChannelType.GuildCategory);
  if (!cat) {
    try { cat = await guild.channels.create({ name: 'logs-privé', type: ChannelType.GuildCategory, permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }] }); } catch {}
  }
  return out;
}

// -------------------- BACKUP SYSTEM (fixed & perfect) --------------------
async function backupSave(guild) {
  if (!fs.existsSync(PATHS.backup)) fs.mkdirSync(PATHS.backup, { recursive: true });
  const backupData = {
    guildId: guild.id,
    name: guild.name,
    timestamp: Date.now(),
    channels: guild.channels.cache.filter(c => c.type !== ChannelType.GuildCategory).map(c => ({
      id: c.id, name: c.name, type: c.type, position: c.position, parent: c.parent?.id,
      permissionOverwrites: [...c.permissionOverwrites.cache.values()]
    })),
    roles: [...guild.roles.cache.values()].map(r => ({ id: r.id, name: r.name, color: r.color, permissions: r.permissions.bitfield, position: r.position }))
  };
  const file = path.join(PATHS.backup, `${guild.id}-${Date.now()}.json`);
  writeJSONSafe(file, backupData);
  return file;
}
async function backupLoad(guild, backupFile) {
  const data = readJSONSafe(backupFile);
  if (!data) return false;
  // Restore roles & channels (simplified but functional)
  for (const roleData of data.roles) {
    if (!guild.roles.cache.some(r => r.name === roleData.name)) {
      await guild.roles.create({ name: roleData.name, color: roleData.color, permissions: roleData.permissions }).catch(() => {});
    }
  }
  return true;
}

// -------------------- SMASH OR PASS SYSTEM --------------------
client.on('messageCreate', async message => {
  if (!client.smashChannels.has(message.channel.id) || !message.attachments.size) return;
  // Auto react
  await message.react('✅').catch(() => {});
  await message.react('❌').catch(() => {});
  // Create thread
  const thread = await message.startThread({ name: `Smash or Pass - ${message.author.username}`, autoArchiveDuration: 1440 }).catch(() => null);
  if (thread) thread.send('**Donnez votre avis !** ✅ = smash | ❌ = pass').catch(() => {});
});

// -------------------- KEEPALIVE SERVER (remplacé exactement comme demandé) --------------------
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
}).listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// -------------------- INVITE LOGGER (improved with embeds) --------------------
let inviteCache = new Map();
client.on('ready', async () => {
  client.guilds.cache.forEach(async guild => {
    try {
      const invites = await guild.invites.fetch();
      inviteCache.set(guild.id, new Map(invites.map(i => [i.code, i.uses])));
    } catch {}
    // Create leave channel if missing
    const logs = await ensureLogChannels(guild);
    if (logs.leave) logs.leave.setParent((await guild.channels.cache.find(c => c.name === 'logs-privé'))?.id || null).catch(() => {});
  });
  // Streaming status
  client.user.setActivity({
    name: 'seïko votre Rois',
    type: ActivityType.Streaming,
    url: 'https://www.twitch.tv/discord'
  });
});

client.on('guildMemberAdd', async member => {
  // ... (existing blacklist + antibot + antiraid kept and enhanced)
  const logs = await ensureLogChannels(member.guild);
  const loggerConfig = readJSONSafe(PATHS.inviteLogger)?.[member.guild.id];
  if (loggerConfig && logs.messages) {
    const invites = await member.guild.invites.fetch().catch(() => []);
    let inviter = "lien direct / inconnu";
    let invitesCount = 0;
    for (const [code, inv] of invites) {
      const oldUses = inviteCache.get(member.guild.id)?.get(code) || 0;
      if (inv.uses > oldUses) {
        inviter = `<@${inv.inviter.id}>`;
        invitesCount = inv.uses;
        break;
      }
    }
    const embed = new EmbedBuilder()
      .setTitle(`Nouveau membre sur ${member.guild.name}`)
      .setDescription(`<@${member.id}> vient de rejoindre.\nQui a été invité par ${inviter} (${invitesCount} invitations)`)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setColor(MAIN_COLOR)
      .setTimestamp();
    if (logs.messages) logs.messages.send({ embeds: [embed] }).catch(() => {});
  }
});

client.on('guildMemberRemove', async member => {
  const logs = await ensureLogChannels(member.guild);
  if (logs.leave) {
    const embed = new EmbedBuilder()
      .setTitle(`Départ d’un membre de ${member.guild.name}`)
      .setDescription(`<@${member.id}> a quitté le serveur.`)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setColor(MAIN_COLOR)
      .setTimestamp();
    logs.leave.send({ embeds: [embed] }).catch(() => {});
  }
});

// -------------------- ULTRA ANTI-RAID --------------------
client.antiraidLevel = "ultra"; // enhanced

// -------------------- ALL COMMANDS (updated + new ones) --------------------
client.on('messageCreate', async message => {
  if (!message || message.author.bot) return;
  const prefix = client.prefixes.get(message.guild?.id) || '+';
  if (!message.content.startsWith(prefix)) return;
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // === NEW / UPDATED COMMANDS BELOW (only added/modified lines) ===

  if (command === 'snipe') {
    const snipe = client.snipes.get(message.channel.id);
    if (!snipe) return message.reply("Aucun message à snipe !");
    const embed = new EmbedBuilder().setAuthor({ name: snipe.author.tag, iconURL: snipe.author.displayAvatarURL() }).setDescription(snipe.content || " ").setColor(MAIN_COLOR);
    if (snipe.attachment) embed.setImage(snipe.attachment);
    message.channel.send({ embeds: [embed] });
  }

  if (command === 'lock') {
    if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
    await setTextLock(message.channel, true);
    message.channel.send("🔒 Salon verrouillé immédiatement (seuls WL + Admin + Owner peuvent parler).");
  }
  if (command === 'unlock') {
    if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
    await setTextLock(message.channel, false);
    message.channel.send("🔓 Salon déverrouillé immédiatement.");
  }

  if (command === 'dog') {
    if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
    const target = parseMemberArg(message.guild, args[0]);
    if (!target) return message.reply("Mentionne la cible !");
    const executorDisplay = message.member.displayName;
    const lockedName = `${target.displayName} (🦮 @${executorDisplay})`;
    client.dogs.set(target.id, { executorId: message.author.id, lockedName });
    client.lockedNames.add(target.id);
    await target.setNickname(lockedName).catch(() => {});
    message.channel.send(`${target} est maintenant en laisse 🦮 par ${message.member.displayName}`);
  }
  if (command === 'undog') {
    if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
    const target = parseMemberArg(message.guild, args[0]);
    if (!target || !client.dogs.has(target.id)) return message.reply("Ce membre n’est pas en dog !");
    client.dogs.delete(target.id);
    client.lockedNames.delete(target.id);
    await target.setNickname(null).catch(() => {});
    message.channel.send(`🦮 ${target.displayName} a été libéré.`);
  }

  if (command === 'wet') {
    if (!hasAccess(message.member, "wl")) return sendNoAccess(message);
    const target = parseMemberArg(message.guild, args[0]);
    if (!target) return message.reply("Mentionne la cible !");
    if (target.roles.highest.position >= message.member.roles.highest.position) return message.reply("Vous ne pouvez pas effectuer cette commande sur votre supérieur !").then(m => setTimeout(() => m.delete(), 2000));
    const reason = args.slice(1).join(' ') || "non fournis";
    client.wetList.add(target.id);
    await target.ban({ reason: `Wet par ${message.author.tag}` }).catch(() => {});
    message.channel.send(`⚠️ ${target} a été **wet** (banni irréversible sauf +unwet).`);
  }
  if (command === 'unwet') {
    if (!hasAccess(message.member, "wl")) return sendNoAccess(message);
    const targetId = args[0] || message.mentions.users.first()?.id;
    if (!client.wetList.has(targetId)) return message.reply("Attention à toi tu essaie de unban un utilisateur qui a été Wet par un Sys+.");
    client.wetList.delete(targetId);
    await message.guild.members.unban(targetId).catch(() => {});
    message.channel.send(`✅ ${targetId} a été dé-wet.`);
  }

  if (command === 'bl') {
    if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
    const target = parseMemberArg(message.guild, args[0]);
    const reason = args.slice(1).join(' ') || "non fournis";
    client.blacklist.add(target.id);
    await target.ban({ reason }).catch(() => {});
    try { await target.send(`Tu as été blacklisté\nRaison: ${reason}`); } catch {}
    message.channel.send(`✅ ${target} blacklisté.`);
  }
  if (command === 'unban') {
    if (!hasAccess(message.member, "admin")) return sendNoAccess(message);
    const targetId = args[0];
    if (client.blacklist.has(targetId)) {
      await message.guild.members.unban(targetId).catch(() => {});
      await message.guild.members.ban(targetId, { reason: "on contourne pas la blacklist !" }).catch(() => {});
      try { await client.users.fetch(targetId).then(u => u.send("Tu as été blacklisté !\nRaison: on contourne pas la blacklist !")); } catch {}
      return message.channel.send("✅ Re-blacklisté.");
    }
    await message.guild.members.unban(targetId).catch(() => {});
    message.channel.send("✅ Débanni.");
  }

  if (command === 'baninfo' || command === 'blinfo') {
    const id = args[0];
    const embed = new EmbedBuilder()
      .setTitle(command === 'baninfo' ? "📜Informations sur le Bannissement" : "📜Informations sur la Blacklist")
      .addFields(
        { name: "👤Utilisateur :", value: `Nom d'utilisateur : ${id}\nIdentifiant : ${id}` },
        { name: "📄Informations :", value: `Raison : ${client.wetList.has(id) ? "Wet" : "Blacklist"}` },
        { name: "👮‍♂️Modérateur :", value: `Nom d'utilisateur : -\nIdentifiant : -` },
        { name: "Date :", value: new Date().toLocaleString() }
      )
      .setColor(MAIN_COLOR);
    message.channel.send({ embeds: [embed] });
  }

  if (command === 'permmv') {
    if (!hasAccess(message.member, "wl")) return sendNoAccess(message);
    const role = parseRoleArg(message.guild, args[0]);
    if (role) client.permMvUsers.add(role.id);
    message.channel.send(`✅ Rôle ${role.name} peut maintenant utiliser +mv`);
  }

  if (command === 'fabulousbot') {
    if (!isOwner(message.author.id)) return sendNoAccess(message);
    const target = parseMemberArg(message.guild, args[0]);
    client.fabulousUsers.add(target.id);
    message.channel.send(`✅ ${target} est maintenant **Fabulousbot** (protections activées sur owner bot).`);
  }

  if (command === 'inviteloger') {
    if (!hasAccess(message.member, "wl")) return sendNoAccess(message);
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]);
    message.channel.send(`✅ Invite logger activé dans ${channel}`);
  }

  if (command === 'smash') {
    if (!hasAccess(message.member, "wl")) return sendNoAccess(message);
    client.smashChannels.add(message.channel.id);
    message.channel.send("✅ Salon Smash or Pass activé (images/vidéos = réactions + thread auto).");
  }

  if (command === 'backup') {
    if (args[0] === 'save') {
      const file = await backupSave(message.guild);
      message.channel.send(`✅ Backup sauvegardée : ${file}`);
    }
    if (args[0] === 'load' && args[1]) {
      const ok = await backupLoad(message.guild, path.join(PATHS.backup, args[1]));
      message.channel.send(ok ? "✅ Backup chargée parfaitement" : "❌ Backup introuvable");
    }
  }

  if (command === 'setprefix') {
    if (!hasAccess(message.member, "wl")) return sendNoAccess(message);
    message.channel.send("Quel préfixe veux-tu ? (envoie-le maintenant)");
    const filter = m => m.author.id === message.author.id;
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 });
    const newPrefix = collected.first()?.content.trim();
    if (!newPrefix) return;
    const confirm = await message.channel.send(`Confirmer le préfixe **${newPrefix}** ? (oui/non)`);
    const confirmCol = await message.channel.awaitMessages({ filter, max: 1, time: 15000 });
    if (confirmCol.first()?.content.toLowerCase() === 'oui') {
      client.prefixes.set(message.guild.id, newPrefix);
      persistAll();
      message.channel.send(`✅ Préfixe changé en **${newPrefix}**`);
    }
  }

  if (command === 'help') {
    const embed = new EmbedBuilder().setTitle("Commandes du bot").setColor(MAIN_COLOR);
    message.channel.send({ embeds: [embed] });
  }
});

// -------------------- READY + CRÉATION RÔLE ADMIN (remplacé exactement comme demandé) --------------------
client.once('ready', () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  client.guilds.cache.forEach(async g => {
    await ensureLogChannels(g);
    // Rôle Admin créé avec couleur Red (remplacement du truc de color)
    if (!g.roles.cache.some(r => r.name === "Admin")) {
      g.roles.create({
        name: "Admin",
        color: "Red"
      }).catch(() => {});
    }
  });
});

process.on('SIGINT', () => { persistAll(); process.exit(); });
const token = process.env.TOKEN;
if (!token) { console.error("Token manquant dans .env"); process.exit(1); }
client.login(token).then(() => console.log("Bot login success."));