require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType, ActivityType } = require('discord.js');

// ==================== CONFIG ====================
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
  inviteLogger: path.join(DATA_DIR, 'inviteLogger.json'),
  ghostJoins: path.join(DATA_DIR, 'ghostJoins.json'),
  fabulousUsers: path.join(DATA_DIR, 'fabulousUsers.json'),
  permAddRole: path.join(DATA_DIR, 'permAddRole.json'),
  smashChannels: path.join(DATA_DIR, 'smashChannels.json'),
  welcomeConfig: path.join(DATA_DIR, 'welcomeConfig.json'),
  backup: path.join(DATA_DIR, 'backup.json')
};

const PORT = process.env.PORT || 10000;
const EXTERNAL_PING_URL = "https://mon-bot-discord-by-seiko.onrender.com/";

// ==================== CLIENT ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildPresences   // ← Ajouté pour récupérer le vrai statut et plateforme
  ]
});

// ==================== STORES ====================
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
client.smashChannels = new Set();
client.welcomeConfig = new Map();
client.jailRoleId = null;

let persistentCooldowns = {};

// ==================== PERSISTENCE ====================
function readJSONSafe(p) {
  try { if (!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}
function writeJSONSafe(p, data) {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch (e) {}
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
  const pvObj = {}; client.pvChannels.forEach((v, k) => pvObj[k] = { allowed: [...v.allowed], ownerId: v.ownerId || null });
  writeJSONSafe(PATHS.pv, pvObj);
  writeJSONSafe(PATHS.lockedTextChannels, [...client.lockedTextChannels]);
  writeJSONSafe(PATHS.inviteLogger, client.inviteLoggerChannel);
  writeJSONSafe(PATHS.ghostJoins, client.ghostJoinsChannel);
  writeJSONSafe(PATHS.fabulousUsers, [...client.fabulousUsers]);
  writeJSONSafe(PATHS.permAddRole, [...client.permAddRole.entries()]);
  writeJSONSafe(PATHS.smashChannels, [...client.smashChannels]);
  writeJSONSafe(PATHS.welcomeConfig, Object.fromEntries(client.welcomeConfig));
  writeJSONSafe(PATHS.backup, { jailRoleId: client.jailRoleId });
}
function loadAll() {
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
  const smash = readJSONSafe(PATHS.smashChannels); if (Array.isArray(smash)) smash.forEach(id => client.smashChannels.add(id));
  const welcomeData = readJSONSafe(PATHS.welcomeConfig); if (welcomeData) client.welcomeConfig = new Map(Object.entries(welcomeData));
  const backupData = readJSONSafe(PATHS.backup); if (backupData && backupData.jailRoleId) client.jailRoleId = backupData.jailRoleId;
}
loadAll();
setInterval(persistAll, 60000);

// ==================== UTILS ====================
const isOwner = id => id === OWNER_ID;
const isWL = id => client.whitelist.has(id) || isOwner(id);
const isAdmin = member => member?.permissions?.has(PermissionsBitField.Flags.Administrator) || client.adminUsers.has(member?.id);

function hasAccess(member, level) {
  if (!member) return false;
  const id = member.id;
  if (level === "owner") return isOwner(id);
  if (level === "wl") return isWL(id);
  if (level === "admin") return isAdmin(member) || isWL(id) || isOwner(id);
  if (level === "everyone") return true;
  return false;
}

// Fonction pour récupérer le vrai statut et plateforme
function getStatusAndPlatform(member) {
  if (!member.presence) return { status: "Hors ligne", platform: "Inconnu" };

  const statusMap = {
    online: "🟢 En ligne",
    idle: "🟡 Inactif",
    dnd: "🔴 Ne pas déranger",
    offline: "⚫ Hors ligne"
  };

  let statusText = statusMap[member.presence.status] || "Hors ligne";

  let platform = "Inconnu";
  if (member.presence.clientStatus) {
    if (member.presence.clientStatus.mobile) platform = "Mobile";
    else if (member.presence.clientStatus.desktop) platform = "Ordinateur";
    else if (member.presence.clientStatus.web) platform = "Web";
  }

  return { status: statusText, platform };
}

// ==================== KEEP-ALIVE ====================
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is alive');
}).listen(PORT, '0.0.0.0', () => console.log(`✅ Keep-alive on port ${PORT}`));

setInterval(() => { try { https.get(EXTERNAL_PING_URL).on('error', () => {}); } catch (e) {} }, 300000);

// ==================== EVENTS ====================
client.on('messageDelete', message => {
  if (!message?.author || message.author.bot) return;
  client.snipes.set(message.channel.id, {
    content: message.content || "",
    author: message.author,
    timestamp: Date.now(),
    attachments: [...message.attachments.values()].map(a => a.url)
  });
});

client.on('guildMemberAdd', async member => {
  if (!client.inviteLoggerChannel) return;
  const ch = member.guild.channels.cache.get(client.inviteLoggerChannel);
  if (!ch) return;
  let inviter = "inconnu", count = 0;
  try {
    const invites = await member.guild.invites.fetch();
    const used = [...invites.values()].find(i => i.uses > (i.uses - 1));
    if (used) { inviter = used.inviter?.tag || "inconnu"; count = used.uses; }
  } catch {}
  const embed = new EmbedBuilder()
    .setTitle(`Nouveau membre sur ${member.guild.name} !`)
    .setDescription(`<@${member.id}> vient de rejoindre. Ils ont été invités par **${inviter}**, qui a maintenant **${count}** invitations ! 🎉`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 1024 }))
    .setColor(MAIN_COLOR)
    .setTimestamp();
  ch.send({ embeds: [embed] });
});

client.on('guildMemberRemove', async member => {
  let leaveCh = member.guild.channels.cache.find(c => c.name.toLowerCase() === "leave");
  if (!leaveCh) leaveCh = await member.guild.channels.create({ name: "leave", type: ChannelType.GuildText }).catch(() => null);
  if (!leaveCh) return;
  const embed = new EmbedBuilder()
    .setTitle(`Départ d'un membre de ${member.guild.name} !`)
    .setDescription(`<@${member.id}> a quitté le serveur. Il avait été invité par **${member.user.tag}**. 😢`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 1024 }))
    .setColor(MAIN_COLOR)
    .setTimestamp();
  leaveCh.send({ embeds: [embed] });
});

// ==================== MESSAGE HANDLER ====================
client.on('messageCreate', async message => {
  if (client.smashChannels.has(message.channel.id) && !message.author.bot) {
    const hasMedia = message.attachments.some(a => a.contentType?.startsWith('image') || a.contentType?.startsWith('video'));
    if (!hasMedia) return message.delete().catch(() => {});
    await message.react('✅').catch(() => {});
    await message.react('❌').catch(() => {});
    message.startThread({ name: "Avis smash/pass", autoArchiveDuration: 1440 }).catch(() => {});
  }

  if (!message.content.startsWith('+') || message.author.bot) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const authorId = message.author.id;
  const member = message.member;

  // +help
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setTitle("Commandes disponibles")
      .setColor(MAIN_COLOR)
      .setDescription(
        `+pic @user → Voir photo de profil\n` +
        `+banner @user → Voir bannière\n` +
        `+lock → Verrouille salon (WL/Admin)\n` +
        `+unlock → Déverrouille salon (WL/Admin)\n` +
        `+dog @user → Verrouille pseudo avec 🐕 (WL/Owner)\n` +
        `+undog @user → Libère le dog (WL/Owner)\n` +
        `+wet @user → Ban spécial (WL/Owner)\n` +
        `+unwet @user → Dé-wet (WL/Owner)\n` +
        `+bl @user → Blacklist + DM (WL/Admin/Owner)\n` +
        `+unbl @user → Dé-blacklist (WL/Admin/Owner)\n` +
        `+baninfo → Infos bannissement\n` +
        `+blinfo → Infos blacklist\n` +
        `+invitelogger ID → Active logs joins/leaves\n` +
        `+ui @user → Infos utilisateur\n` +
        `+snipe → Dernier message supprimé (images/vidéos)\n` +
        `+smash → Active mode smash dans le salon\n` +
        `+flood ID @user <10> → Spam phrases\n` +
        `+mybotserv → Liste des serveurs du bot\n` +
        `+joinsbot ID → Bot rejoint le vocal\n` +
        `+setprefix → Change le préfixe\n` +
        `+backup save/load → Sauvegarde / charge la backup\n` +
        `+antiraid → Active l'anti-raid ultra puissant\n` +
        `+dmall <message> → Envoie MP à tout le serveur (owner only)\n` +
        `+permmv @role → Donne la perm +mv au rôle\n` +
        `+delpermmv @role → Retire la perm +mv\n` +
        `+PermmvRolelist → Liste des rôles avec perm mv\n` +
        `+Permaddrole @role <count> → Donne perm +addrole avec limite\n` +
        `+delpermaddrole @role → Retire la perm +addrole\n` +
        `+fabulousbot @user → Autorise +dog +wakeup +mv sur owner bot\n` +
        `+ghostjoins ID → Active ghost ping joins\n` +
        `+unbanall → Débannit tout (protège les +bl)\n` +
        `+pv → Rend le vocal privé\n` +
        `+pvacces @user → Donne accès au vocal privé\n` +
        `+unpvs → Rend tous les vocaux publics\n` +
        `+jail @user → Met en jail\n` +
        `+unjail @user → Enlève le rôle jail\n` +
        `+mutealls → Mute tous les vocaux\n` +
        `+randomvoc → Déplace aléatoirement dans les vocaux\n` +
        `+say ID <message> → Envoie message dans un salon\n` +
        `+mv @user → Déplace en vocal\n` +
        `+wakeup @user <times> → Réveille quelqu'un\n` +
        `+snap @user → Demande snap\n` +
        `+clear <nombre> ou @user → Supprime messages\n` +
        `+slowmode <secondes> → Mode lent\n` +
        `+ping → Répond\n` +
        `+welcome ID <message> → Configure message de bienvenue\n` +
        `+delchannel ID → Supprime un salon (WL/Owner)\n` +
        `+limitrole @role <max> → Limite un rôle\n` +
        `+addrole @user @role → Ajoute rôle\n` +
        `+delrole @user @role → Retire rôle\n` +
        `+derank @user → Retire tous les rôles`
      );
    return message.channel.send({ embeds: [embed] });
  }

  // +ui – STYLE IDENTIQUE À TON IMAGE + VRAI STATUT ET PLATEFORME
  if (cmd === 'ui') {
    const target = message.mentions.members.first() || message.member;
    const user = target.user;

    const { status, platform } = getStatusAndPlatform(target);

    const createdStr = user.createdAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const joinedStr = target.joinedAt ? target.joinedAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : "Inconnu";

    const createdAgo = Math.floor((Date.now() - user.createdTimestamp) / (1000 * 60 * 60 * 24));
    const joinedAgo = target.joinedAt ? Math.floor((Date.now() - target.joinedAt) / (1000 * 60 * 60 * 24)) : 0;

    const roles = target.roles.cache.filter(r => r.id !== target.guild.id).map(r => r.toString()).join(" ") || "Aucun rôle";

    const embed = new EmbedBuilder()
      .setTitle(user.tag)
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 }))
      .setColor(MAIN_COLOR)
      .addFields(
        { name: "Compte", value: `@${user.username}`, inline: false },
        { name: "Pseudo", value: target.displayName, inline: false },
        { name: "Id", value: user.id, inline: false },
        { name: "Activité/Statut", value: `Statut : ${status}`, inline: false },
        { name: "Plateforme", value: `Plateforme : ${platform}`, inline: false },
        { name: "Activité", value: "—", inline: false },
        { name: "Vocal", value: target.voice?.channel ? "En vocal" : "Pas en vocal", inline: false },
        { name: "Dates", value: `Créé : ${createdStr} (il y a ${createdAgo} jours)\nRejoint : ${joinedStr} (il y a ${joinedAgo} jours)`, inline: false },
        { name: "Rôles", value: roles, inline: false }
      );

    return message.channel.send({ embeds: [embed] });
  }

  // +jail (conservé)
  if (cmd === 'jail') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");

    let target = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!target) return message.reply("Mentionne la cible ou donne son ID.");

    let jailRole = message.guild.roles.cache.find(r => r.name === "Jail");
    if (!jailRole) {
      jailRole = await message.guild.roles.create({
        name: "Jail",
        color: "Red",
        permissions: [],
        reason: "Rôle Jail créé par +jail"
      });
      client.jailRoleId = jailRole.id;
    }

    let logCategory = message.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === "logs-privé");
    if (!logCategory) {
      logCategory = await message.guild.channels.create({
        name: "logs-privé",
        type: ChannelType.GuildCategory,
        reason: "Catégorie logs privé"
      }).catch(() => null);
    }

    await target.roles.set([jailRole]).catch(() => {});

    message.guild.channels.cache.forEach(async channel => {
      if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildCategory) {
        await channel.permissionOverwrites.edit(jailRole, {
          ViewChannel: false,
          SendMessages: false,
          Connect: false,
          ReadMessageHistory: false
        }).catch(() => {});
      }
    });

    return message.channel.send(`⛓️ ${target} a été mis en jail. Il ne voit plus aucun salon ni catégorie.`);
  }

  if (cmd === 'unjail') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");

    let target = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!target) return message.reply("Mentionne la cible ou donne son ID.");

    const jailRole = message.guild.roles.cache.find(r => r.name === "Jail");
    if (jailRole && target.roles.cache.has(jailRole.id)) {
      await target.roles.remove(jailRole).catch(() => {});
      return message.channel.send(`✅ ${target} a été libéré du jail.`);
    }
    return message.reply("Cette personne n'est pas en jail.");
  }

  // Commande inconnue
  message.reply("Commande inconnue. Tape `+help` pour la liste complète.");
});

// ==================== READY ====================
client.once('ready', () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
  client.user.setActivity({ name: 'seïko votre Rois', type: ActivityType.Streaming, url: 'https://www.twitch.tv/discord' });
});

// ==================== LOGIN ====================
const token = process.env.TOKEN;
if (!token) {
  console.error("❌ TOKEN manquant dans .env");
  process.exit(1);
}
client.login(token).then(() => console.log("✅ Login réussi")).catch(err => console.error(err));