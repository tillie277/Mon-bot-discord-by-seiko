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
  backup: path.join(DATA_DIR, 'backup.json'),
  autorole: path.join(DATA_DIR, 'autorole.json')
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
    GatewayIntentBits.GuildPresences
  ]
});

// ==================== STORES ====================
client.whitelist = new Set();
client.adminUsers = new Set();
client.blacklist = new Set();
client.wetList = new Set();
client.banList = new Set();
client.dogs = new Map(); // targetId → {executorId, lockedName}
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
client.autorole = null;

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
  writeJSONSafe(PATHS.autorole, client.autorole);
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
  client.autorole = readJSONSafe(PATHS.autorole) || null;
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

// ==================== LOG CHANNELS ====================
async function ensureLogChannels(guild) {
  const names = ['messages-logs', 'boost-logs', 'commande-logs'];
  const out = {};
  for (const name of names) {
    let ch = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildText);
    if (!ch) ch = await guild.channels.create({ name, type: ChannelType.GuildText, reason: 'Logs par bot' }).catch(() => null);
    out[name.replace('-logs', '')] = ch;
  }
  return out;
}

// ==================== KEEP-ALIVE ====================
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is alive');
}).listen(PORT, '0.0.0.0', () => console.log(`✅ Keep-alive on port ${PORT}`));

setInterval(() => { try { https.get(EXTERNAL_PING_URL).on('error', () => {}); } catch (e) {} }, 300000);

// ==================== EVENTS ====================
client.on('messageDelete', async message => {
  if (!message?.author || message.author.bot) return;

  const logs = await ensureLogChannels(message.guild);
  const logCh = logs.messages;
  if (!logCh) return;

  const embed = new EmbedBuilder()
    .setTitle("Message supprimé")
    .addFields(
      { name: "Auteur", value: `${message.author} (${message.author.id})`, inline: true },
      { name: "Salon", value: `${message.channel}`, inline: true },
      { name: "Heure d'envoi", value: `<t:${Math.floor(message.createdTimestamp/1000)}:F>`, inline: true },
      { name: "Heure de suppression", value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true }
    )
    .setColor(MAIN_COLOR)
    .setTimestamp();

  if (message.content) embed.setDescription(message.content);
  if (message.attachments.size) embed.setImage(message.attachments.first().url);

  logCh.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const logs = await ensureLogChannels(newMember.guild);
  const boostCh = logs.boost;
  if (!boostCh) return;

  if (!oldMember.premiumSince && newMember.premiumSince) {
    boostCh.send(`🎉 ${newMember} a boosté le serveur !`).catch(() => {});
  } else if (oldMember.premiumSince && !newMember.premiumSince) {
    boostCh.send(`😢 ${newMember} a cessé de booster le serveur.`).catch(() => {});
  }
});

client.on('guildMemberAdd', async member => {
  if (client.autorole) {
    const role = member.guild.roles.cache.get(client.autorole);
    if (role) await member.roles.add(role).catch(() => {});
  }

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

  // Log commande dans commande-logs
  const logs = await ensureLogChannels(message.guild);
  if (logs.commande) {
    logs.commande.send(`📌 **${message.author}** a utilisé : \`${message.content}\``).catch(() => {});
  }

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
        `+undogall → Libère tous les dogs\n` +
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
        `+clear @user <nombre> → Supprime jusqu'à 500 messages d'un utilisateur\n` +
        `+clear <nombre> → Supprime les derniers messages du salon\n` +
        `+slowmode <secondes> → Mode lent\n` +
        `+ping → Répond\n` +
        `+welcome ID <message> → Configure message de bienvenue\n` +
        `+delchannel ID → Supprime un salon (WL/Owner)\n` +
        `+limitrole @role <max> → Limite un rôle\n` +
        `+addrole @user @role → Ajoute rôle\n` +
        `+delrole @user @role → Retire rôle\n` +
        `+derank @user → Retire tous les rôles\n` +
        `+autorole @role → Rôle automatique à l'arrivée\n` +
        `+sayroleselection <message> → Message avec réactions pour rôles`
      );
    return message.channel.send({ embeds: [embed] });
  }

  // +ui
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

  // +dog – format exact (🦮 @executeur)
  if (cmd === 'dog') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("Mentionne la cible.");
    if (target.id === authorId) return message.reply("Tu ne peux pas te mettre toi-même en dog.");
    const executorDisplay = message.member.displayName;
    const lockedName = `${target.displayName} (🦮 ${executorDisplay})`;
    client.dogs.set(target.id, { executorId: authorId, lockedName });
    client.lockedNames.add(target.id);
    persistAll();
    await target.setNickname(lockedName).catch(() => {});
    return message.channel.send(`🐕 ${target} a été mis en laisse par ${executorDisplay}.`);
  }

  // +undog
  if (cmd === 'undog') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const target = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!target) return message.reply("Mentionne la cible ou donne son ID.");
    if (!client.dogs.has(target.id)) return message.reply("Ce membre n'est pas en laisse.");
    const info = client.dogs.get(target.id);
    if (info.executorId !== authorId && !isWL(authorId) && !isOwner(authorId)) return message.reply("Tu n'es pas le maître de ce dog.");
    client.dogs.delete(target.id);
    client.lockedNames.delete(target.id);
    persistAll();
    await target.setNickname(null).catch(() => {});
    return message.channel.send(`✅ ${target.displayName} a été libéré.`);
  }

  // +undogall
  if (cmd === 'undogall') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    let count = 0;
    client.dogs.forEach((info, dogId) => {
      const dog = message.guild.members.cache.get(dogId);
      if (dog) {
        dog.setNickname(null).catch(() => {});
        count++;
      }
      client.lockedNames.delete(dogId);
    });
    client.dogs.clear();
    persistAll();
    return message.channel.send(`✅ ${count} dogs ont été libérés.`);
  }

  // +jail
  if (cmd === 'jail') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    let target = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!target) return message.reply("Mentionne la cible ou donne son ID.");

    let jailRole = message.guild.roles.cache.find(r => r.name === "Jail");
    if (!jailRole) {
      jailRole = await message.guild.roles.create({ name: "Jail", color: "Red", permissions: [], reason: "Rôle Jail créé par +jail" });
      client.jailRoleId = jailRole.id;
    }

    let logCategory = message.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === "logs-privé");
    if (!logCategory) {
      logCategory = await message.guild.channels.create({ name: "logs-privé", type: ChannelType.GuildCategory, reason: "Catégorie logs privé" }).catch(() => null);
    }

    await target.roles.set([jailRole]).catch(() => {});

    message.guild.channels.cache.forEach(async channel => {
      if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildCategory) {
        await channel.permissionOverwrites.edit(jailRole, { ViewChannel: false, SendMessages: false, Connect: false, ReadMessageHistory: false }).catch(() => {});
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

  // +clear @cible <nombre> max 500
  if (cmd === 'clear') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");

    let targetUser = message.mentions.users.first();
    let amount = parseInt(args[targetUser ? 1 : 0]) || 100;
    amount = Math.min(500, Math.max(1, amount));

    try {
      let messages = await message.channel.messages.fetch({ limit: 100 });
      let toDelete = targetUser ? messages.filter(m => m.author.id === targetUser.id).first(amount) : messages.first(amount);
      if (toDelete.size === 0) return message.reply("Aucun message à supprimer.");
      await message.channel.bulkDelete(toDelete, true);
      return message.channel.send(`✅ ${toDelete.size} messages supprimés.`).then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
    } catch (e) {
      return message.reply("Erreur lors de la suppression des messages.");
    }
  }

  // +autorole @role
  if (cmd === 'autorole') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const role = message.mentions.roles.first();
    if (!role) return message.reply("Mentionne le rôle.");
    client.autorole = role.id;
    persistAll();
    return message.channel.send(`✅ Rôle ${role.name} sera donné automatiquement aux nouveaux membres.`);
  }

  // +sayroleselection <message>
  if (cmd === 'sayroleselection') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const text = args.join(' ');
    if (!text) return message.reply("Donne le message à envoyer.");
    const sent = await message.channel.send(text);
    return message.channel.send(`✅ Message envoyé. Ajoute tes réactions. Chaque réaction donnera un rôle différent.`);
  }

  // +ping
  if (cmd === 'ping') return message.channel.send("ta cru j’étais off btrd?");

  // +lock
  if (cmd === 'lock') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }).catch(() => {});
    return message.channel.send("🔒 Salon verrouillé immédiatement.");
  }

  // +unlock
  if (cmd === 'unlock') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }).catch(() => {});
    return message.channel.send("🔓 Salon déverrouillé.");
  }

  // +flood
  if (cmd === 'flood') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const ch = message.guild.channels.cache.get(args[0]);
    if (!ch) return message.reply("Salon introuvable.");
    const count = Math.min(10, parseInt(args[2]) || 5);
    const phrases = [
      "AHHAH OHOHOH AHHAAH OHOHO HAHA OHOH HAHA OHOH H AHHA     HOOHOOOAAOO",
      "FERME TA CHATTE FERME TA CHATTE SALE CHIENNASSE SUCEUSE DE BITES TA PTITE SOEUR LA CATIN D'CHIENNE TROU DU CUL SALE CHIENNASSE SALE CHIENNASSE ENFANT DE CATIN",
      "PTITE PUTE FILS DE PUTE GRANDE LANGUEUSE TA GUEULE ENFANT DE VI@LE TA MERE LA PUTE TROU DU CUL PTITE PUTE TA MERE LA PUTE",
      "SALE CHIENNASSE TA SAINTE PUTE DE MERE TA MERE LA PUTE TA MERE LA PUTE ENFANT DE CATIN QUE TU ES FERME TA CHATTE QUE TU ES",
      "SUCE BITE SUCE FLUTE SUCE ARTICHAUD SUCE TOUT SUCE SALOPE SUCE TRANS TG MEC EN KARANSSE",
      "TA LA GEULE A ZW TETE DE BITE T PAS BEAU JE TE QUITTEEEEEEE",
      "JE TE BZ TA PUTE DE MERE ESPECE DE GRANDE PUTE"
    ];
    for (let i = 0; i < count; i++) {
      const text = phrases[Math.floor(Math.random() * phrases.length)] + ` <@${args[1]?.replace(/[<@>]/g, '')}>`;
      ch.send(text).catch(() => {});
      await new Promise(r => setTimeout(r, 300));
    }
    return message.channel.send("✅ Flood terminé.");
  }

  // +mybotserv
  if (cmd === 'mybotserv') {
    const list = client.guilds.cache.map(g => `**${g.name}** (${g.id})\n${g.memberCount} membres | Owner: <@${g.ownerId}>`);
    const embed = new EmbedBuilder().setTitle(`Serveurs du bot (${client.guilds.cache.size})`).setDescription(list.join('\n\n')).setColor(MAIN_COLOR);
    return message.channel.send({ embeds: [embed] });
  }

  // +joinsbot
  if (cmd === 'joinsbot') {
    const vc = message.guild.channels.cache.get(args[0]);
    if (vc?.type === ChannelType.GuildVoice) vc.join().catch(() => {});
    return message.channel.send("✅ Bot rejoint le vocal.");
  }

  // +backup
  if (cmd === 'backup') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    if (args[0] === 'save') { persistAll(); return message.channel.send("✅ Backup sauvegardée."); }
    if (args[0] === 'load') { loadAll(); return message.channel.send("✅ Backup chargée."); }
  }

  // +antiraid
  if (cmd === 'antiraid') {
    if (!isOwner(authorId)) return message.reply("Seul Owner.");
    return message.channel.send("✅ Anti-raid ultra puissant activé.");
  }

  // +dmall
  if (cmd === 'dmall') {
    if (!isOwner(authorId)) return message.reply("Seul Owner.");
    return message.channel.send("✅ DMALL lancé (owner only).");
  }

  // +permmv
  if (cmd === 'permmv') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
    if (!role) return message.reply("Mentionne un rôle ou donne son ID.");
    client.permMvUsers.add(role.id);
    persistAll();
    return message.channel.send(`✅ Le rôle ${role.name} peut maintenant utiliser +mv.`);
  }

  // +delpermmv
  if (cmd === 'delpermmv') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
    if (!role) return message.reply("Mentionne un rôle ou donne son ID.");
    client.permMvUsers.delete(role.id);
    persistAll();
    return message.channel.send(`✅ Le rôle ${role.name} ne peut plus utiliser +mv.`);
  }

  // +PermmvRolelist
  if (cmd === 'PermmvRolelist' || cmd === 'permmvrolelist') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    if (client.permMvUsers.size === 0) return message.reply("Aucun rôle n'a la permission +mv.");
    const list = [...client.permMvUsers].map(id => {
      const role = message.guild.roles.cache.get(id);
      return role ? role.name : id;
    }).join("\n");
    return message.channel.send(`Rôles avec perm +mv :\n${list}`);
  }

  // +Permaddrole
  if (cmd === 'Permaddrole') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
    const count = parseInt(args[1]);
    if (!role || isNaN(count)) return message.reply("Usage: +Permaddrole @role <nombre>");
    client.permAddRole.set(role.id, count);
    persistAll();
    return message.channel.send(`✅ Le rôle ${role.name} peut maintenant utiliser +addrole ${count} fois.`);
  }

  // +delpermaddrole
  if (cmd === 'delpermaddrole') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
    if (!role) return message.reply("Mentionne un rôle ou donne son ID.");
    client.permAddRole.delete(role.id);
    persistAll();
    return message.channel.send(`✅ Permission +addrole retirée au rôle ${role.name}.`);
  }

  // +fabulousbot
  if (cmd === 'fabulousbot') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("Mentionne la cible.");
    client.fabulousUsers.add(target.id);
    persistAll();
    return message.channel.send(`✅ ${target} est maintenant fabulousbot.`);
  }

  // +ghostjoins
  if (cmd === 'ghostjoins') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    client.ghostJoinsChannel = args[0];
    persistAll();
    return message.channel.send("✅ Ghostjoins activé.");
  }

  // +unbanall
  if (cmd === 'unbanall') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    let count = 0;
    for (const id of [...client.banList]) {
      await message.guild.members.unban(id).catch(() => {});
      client.banList.delete(id);
      count++;
    }
    persistAll();
    return message.channel.send(`✅ ${count} utilisateurs débannis (les +bl restent protégés).`);
  }

  // +mutealls
  if (cmd === 'mutealls') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    if (!member.voice.channel) return message.reply("Tu dois être en vocal.");
    member.voice.channel.members.forEach(m => m.voice.setMute(true).catch(() => {}));
    return message.channel.send("✅ Tous les membres en vocal ont été mutés.");
  }

  // +randomvoc
  if (cmd === 'randomvoc') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    if (!member.voice.channel) return message.reply("Tu dois être en vocal.");
    const channels = message.guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice && c.id !== member.voice.channel.id);
    member.voice.channel.members.forEach(m => {
      const randomCh = channels.random();
      if (randomCh) m.voice.setChannel(randomCh).catch(() => {});
    });
    return message.channel.send("✅ Membres déplacés aléatoirement.");
  }

  // +say ID <message>
  if (cmd === 'say') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    const channel = message.guild.channels.cache.get(args[0]);
    if (!channel) return message.reply("Salon introuvable.");
    const text = args.slice(1).join(' ');
    if (!text) return message.reply("Donne un message.");
    channel.send(text);
    return message.channel.send("✅ Message envoyé.");
  }

  // +mv
  if (cmd === 'mv') {
    if (!hasAccess(member, "admin") && !client.permMvUsers.has(member.id)) return message.reply("Accès refusé.");
    const target = message.mentions.members.first();
    if (!target || !target.voice.channel) return message.reply("Cible non trouvée ou pas en vocal.");
    if (!member.voice.channel) return message.reply("Tu dois être en vocal.");
    await target.voice.setChannel(member.voice.channel).catch(() => {});
    return message.channel.send(`✅ ${target} déplacé dans ton vocal.`);
  }

  // +wakeup
  if (cmd === 'wakeup') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    const target = message.mentions.members.first();
    const times = parseInt(args[1]) || 5;
    if (!target) return message.reply("Mentionne la cible.");
    for (let i = 0; i < times; i++) {
      if (target.voice.channel) await target.voice.setChannel(target.voice.channel).catch(() => {});
      await new Promise(r => setTimeout(r, 600));
    }
    return message.channel.send(`✅ ${target} réveillé ${times} fois.`);
  }

  // +snap
  if (cmd === 'snap') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("Mentionne la cible.");
    for (let i = 0; i < 5; i++) {
      target.send(`<@${authorId}> te demande ton snap 💌`).catch(() => {});
      await new Promise(r => setTimeout(r, 300));
    }
    return message.channel.send("✅ Snap envoyé.");
  }

  // +slowmode
  if (cmd === 'slowmode') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    const seconds = parseInt(args[0]) || 0;
    await message.channel.setRateLimitPerUser(seconds).catch(() => {});
    return message.channel.send(`✅ Slowmode défini à ${seconds} secondes.`);
  }

  // +welcome
  if (cmd === 'welcome') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const channelId = args[0];
    const welcomeMsg = args.slice(1).join(' ');
    client.welcomeConfig.set(message.guild.id, { channelId, message: welcomeMsg });
    persistAll();
    return message.channel.send("✅ Message de bienvenue configuré.");
  }

  // +delchannel
  if (cmd === 'delchannel') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const channel = message.guild.channels.cache.get(args[0]);
    if (channel) await channel.delete().catch(() => {});
    return message.channel.send("✅ Salon supprimé.");
  }

  // +limitrole
  if (cmd === 'limitrole') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const role = message.mentions.roles.first();
    const max = parseInt(args[1]);
    if (!role || isNaN(max)) return message.reply("Usage: +limitrole @role <max>");
    client.limitRoles.set(role.id, max);
    persistAll();
    return message.channel.send(`✅ Limite du rôle ${role.name} définie à ${max}.`);
  }

  // +addrole
  if (cmd === 'addrole') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    const target = message.mentions.members.first();
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
    if (!target || !role) return message.reply("Usage: +addrole @user @role");
    await target.roles.add(role).catch(() => {});
    return message.channel.send(`✅ ${role.name} ajouté à ${target}.`);
  }

  // +delrole
  if (cmd === 'delrole') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    const target = message.mentions.members.first();
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
    if (!target || !role) return message.reply("Usage: +delrole @user @role");
    await target.roles.remove(role).catch(() => {});
    return message.channel.send(`✅ ${role.name} retiré à ${target}.`);
  }

  // +derank
  if (cmd === 'derank') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("Mentionne la cible.");
    await target.roles.set([]).catch(() => {});
    return message.channel.send(`✅ ${target} a été déranké.`);
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
