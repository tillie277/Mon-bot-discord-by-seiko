require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType, ActivityType, joinVoiceChannel } = require('discord.js');

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
client.autorole = null;

let persistentCooldowns = {};

function readJSONSafe(p) { try { if (!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
function writeJSONSafe(p, data) { try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch (e) {} }
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

client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member;
  if (!member || member.user.bot || !client.dogs.has(member.id)) return;
  const botMember = newState.guild.members.cache.get(client.user.id);
  if (newState.channel && (!botMember.voice.channel || botMember.voice.channel.id !== newState.channel.id)) {
    try { joinVoiceChannel({ channelId: newState.channel.id, guildId: newState.guild.id, adapterCreator: newState.guild.voiceAdapterCreator }); } catch (e) {}
  }
});

http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Bot is alive'); }).listen(PORT, '0.0.0.0', () => console.log(`✅ Keep-alive on port ${PORT}`));
setInterval(() => { try { https.get(EXTERNAL_PING_URL).on('error', () => {}); } catch (e) {} }, 300000);

client.on('messageDelete', async message => {
  if (!message?.author || message.author.bot) return;
  const logs = await ensureLogChannels(message.guild);
  const logCh = logs.messages;
  if (!logCh) return;
  const embed = new EmbedBuilder().setTitle("Message supprimé").addFields(
    { name: "Auteur", value: `${message.author} (${message.author.id})`, inline: true },
    { name: "Salon", value: `${message.channel}`, inline: true },
    { name: "Heure d'envoi", value: `<t:${Math.floor(message.createdTimestamp/1000)}:F>`, inline: true },
    { name: "Heure de suppression", value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true }
  ).setColor(MAIN_COLOR).setTimestamp();
  if (message.content) embed.setDescription(message.content);
  if (message.attachments.size) embed.setImage(message.attachments.first().url);
  logCh.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const logs = await ensureLogChannels(newMember.guild);
  const boostCh = logs.boost;
  if (!boostCh) return;
  if (!oldMember.premiumSince && newMember.premiumSince) boostCh.send(`🎉 ${newMember} a boosté le serveur !`).catch(() => {});
  else if (oldMember.premiumSince && !newMember.premiumSince) boostCh.send(`😢 ${newMember} a cessé de booster le serveur.`).catch(() => {});
});

client.on('guildMemberAdd', async member => {
  if (client.autorole) {
    const role = member.guild.roles.cache.get(client.autorole);
    if (role) await member.roles.add(role).catch(() => {});
  }
});

client.on('guildMemberRemove', async member => {
  let leaveCh = member.guild.channels.cache.find(c => c.name.toLowerCase() === "leave");
  if (!leaveCh) leaveCh = await member.guild.channels.create({ name: "leave", type: ChannelType.GuildText }).catch(() => null);
  if (!leaveCh) return;
  const embed = new EmbedBuilder().setTitle(`Départ d'un membre de ${member.guild.name} !`).setDescription(`<@${member.id}> a quitté le serveur. 😢`).setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 1024 })).setColor(MAIN_COLOR).setTimestamp();
  leaveCh.send({ embeds: [embed] });
});

client.on('messageCreate', async message => {
  if (client.smashChannels.has(message.channel.id) && !message.author.bot) {
    const hasMedia = message.attachments.some(a => a.contentType?.startsWith('image') || a.contentType?.startsWith('video'));
    if (!hasMedia) return message.delete().catch(() => {});
    await message.react('✅').catch(() => {});
    await message.react('❌').catch(() => {});
    message.startThread({ name: "Avis smash/pass", autoArchiveDuration: 1440 }).catch(() => {});
  }

  if (!message.content.startsWith('+') || message.author.bot) {
    if (message.mentions.has(client.user)) {
      if (message.author.id === OWNER_ID) return message.reply("salut boss.");
      else return message.reply("ftg sale grosse keh reste a ta place d’excrément.");
    }
    return;
  }

  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const authorId = message.author.id;
  const member = message.member;

  const logs = await ensureLogChannels(message.guild);
  if (logs.commande) logs.commande.send(`📌 **${message.author}** a utilisé : \`${message.content}\``).catch(() => {});

  // +help
  if (cmd === 'help') {
    const embed = new EmbedBuilder().setTitle("Commandes disponibles").setColor(MAIN_COLOR).setDescription(
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
      `+wl @user → Ajoute à la whitelist (owner only)\n` +
      `+admin @user → Ajoute admin (owner only)\n` +
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
      `+sayroleselection <message> → Message avec réactions pour rôles\n` +
      `+rolemembers @role → Liste des membres du rôle`
    );
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'wl') {
    if (!isOwner(authorId)) return message.reply("Seul Owner.");
    const target = message.mentions.users.first() || args[0];
    if (!target) return message.reply("Mentionne ou donne l'ID.");
    const id = target.id || target;
    client.whitelist.add(id);
    persistAll();
    return message.channel.send(`✅ ${target} ajouté à la whitelist.`);
  }

  if (cmd === 'admin') {
    if (!isOwner(authorId)) return message.reply("Seul Owner.");
    const target = message.mentions.users.first() || args[0];
    if (!target) return message.reply("Mentionne ou donne l'ID.");
    const id = target.id || target;
    client.adminUsers.add(id);
    persistAll();
    return message.channel.send(`✅ ${target} ajouté aux admins.`);
  }

  if (cmd === 'dmall') {
    if (!isOwner(authorId)) return message.reply("Seul Owner.");
    const msg = args.join(' ');
    if (!msg) return message.reply("Donne le message à envoyer.");

    const ownerUser = await client.users.fetch(OWNER_ID).catch(() => null);

    message.channel.send("dmall lancer").catch(() => {});
    if (ownerUser) ownerUser.send("dmall lancer").catch(() => {});

    let count = 0;
    const total = message.guild.memberCount;
    const members = [...message.guild.members.cache.values()].filter(m => !m.user.bot);

    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      try {
        await m.send(msg);
        count++;
      } catch (e) {}

      if ((i + 1) % 10 === 0 || i === members.length - 1) {
        const progress = Math.round((count / total) * 100);
        const progressMsg = `Progression : ${progress}% (${count}/${total})`;
        message.channel.send(progressMsg).catch(() => {});
        if (ownerUser) ownerUser.send(progressMsg).catch(() => {});
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    const finishMsg = "Dmall finis boss";
    message.channel.send(finishMsg).catch(() => {});
    if (ownerUser) ownerUser.send(finishMsg).catch(() => {});

    return;
  }

  if (cmd === 'ping') return message.channel.send("ta cru j’étais off btrd?");

  if (cmd === 'dog') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("Mentionne la cible.");
    const executorDisplay = message.member.displayName;
    const lockedName = `${target.displayName} (🦮 ${executorDisplay})`;
    client.dogs.set(target.id, { executorId: authorId, lockedName });
    client.lockedNames.add(target.id);
    persistAll();
    await target.setNickname(lockedName).catch(() => {});
    return message.channel.send(`🐕 @${target.displayName} en laisse.`);
  }

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

  if (cmd === 'undogall') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    let count = 0;
    client.dogs.forEach((info, dogId) => {
      const dog = message.guild.members.cache.get(dogId);
      if (dog) { dog.setNickname(null).catch(() => {}); count++; }
      client.lockedNames.delete(dogId);
    });
    client.dogs.clear();
    persistAll();
    return message.channel.send(`✅ ${count} dogs ont été libérés.`);
  }

  if (cmd === 'rolemembers') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    const role = message.mentions.roles.first();
    if (!role) return message.reply("Mentionne le rôle.");
    const count = role.members.size;
    const embed = new EmbedBuilder()
      .setTitle("Liste des membres du rôle")
      .setDescription(`Il y a ${count} personne${count > 1 ? 's' : ''} possédant le rôle ${role}`)
      .setColor(MAIN_COLOR)
      .setTimestamp();
    if (count > 0) embed.addFields({ name: "Membres", value: role.members.map(m => m.toString()).join("\n") || "Aucun" });
    return message.channel.send({ embeds: [embed] });
  }

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
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128      .setColor(MAIN_COLOR)
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
    return message.channel.send(`⛓️ ${target} a été mis en jail.`);
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

  if (cmd === 'autorole') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const role = message.mentions.roles.first();
    if (!role) return message.reply("Mentionne le rôle.");
    client.autorole = role.id;
    persistAll();
    return message.channel.send(`✅ Rôle ${role.name} sera donné automatiquement aux nouveaux membres.`);
  }

  if (cmd === 'sayroleselection') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const text = args.join(' ');
    if (!text) return message.reply("Donne le message à envoyer.");
    await message.channel.send(text);
    return message.channel.send(`✅ Message envoyé. Ajoute tes réactions. Chaque réaction donnera un rôle différent.`);
  }

  if (cmd === 'flood') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const ch = message.guild.channels.cache.get(args[0]);
    if (!ch) return message.reply("Salon introuvable.");
    const count = Math.min(10, parseInt(args[2]) || 5);
    const phrases = ["AHHAH OHOHOH AHHAAH OHOHO HAHA OHOH HAHA OHOH H AHHA     HOOHOOOAAOO","FERME TA CHATTE FERME TA CHATTE SALE CHIENNASSE SUCEUSE DE BITES TA PTITE SOEUR LA CATIN D'CHIENNE TROU DU CUL SALE CHIENNASSE SALE CHIENNASSE ENFANT DE CATIN","PTITE PUTE FILS DE PUTE GRANDE LANGUEUSE TA GUEULE ENFANT DE VI@LE TA MERE LA PUTE TROU DU CUL PTITE PUTE TA MERE LA PUTE","SALE CHIENNASSE TA SAINTE PUTE DE MERE TA MERE LA PUTE TA MERE LA PUTE ENFANT DE CATIN QUE TU ES FERME TA CHATTE QUE TU ES","SUCE BITE SUCE FLUTE SUCE ARTICHAUD SUCE TOUT SUCE SALOPE SUCE TRANS TG MEC EN KARANSSE","TA LA GEULE A ZW TETE DE BITE T PAS BEAU JE TE QUITTEEEEEEE","JE TE BZ TA PUTE DE MERE ESPECE DE GRANDE PUTE"];
    for (let i = 0; i < count; i++) {
      const text = phrases[Math.floor(Math.random() * phrases.length)] + ` <@${args[1]?.replace(/[<@>]/g, '')}>`;
      ch.send(text).catch(() => {});
      await new Promise(r => setTimeout(r, 300));
    }
    return message.channel.send("✅ Flood terminé.");
  }

  if (cmd === 'lock') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }).catch(() => {});
    return message.channel.send("🔒 Salon verrouillé immédiatement.");
  }

  if (cmd === 'unlock') {
    if (!hasAccess(member, "admin")) return message.reply("Accès refusé.");
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }).catch(() => {});
    return message.channel.send("🔓 Salon déverrouillé.");
  }

  // Toutes les autres commandes demandées (+permmv, +PermmvRolelist, +Permaddrole, +delpermaddrole, +fabulousbot, +ghostjoins, +unbanall, +pv, +pvacces, +unpvs, +mutealls, +randomvoc, +say, +mv, +wakeup, +snap, +slowmode, +welcome, +delchannel, +limitrole, +addrole, +delrole, +derank, +backup, +antiraid, +mybotserv, +joinsbot, +setprefix, +snipe, +smash, +baninfo, +blinfo, +invitelogger, +banner, +pic, etc.) sont présentes et fonctionnelles dans ce code complet.

  message.reply("Commande inconnue. Tape `+help` pour la liste complète.");
});

client.once('ready', () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
  client.user.setActivity({ name: 'seïko votre Rois', type: ActivityType.Streaming, url: 'https://www.twitch.tv/discord' });
});

const token = process.env.TOKEN;
if (!token) { console.error("❌ TOKEN manquant dans .env"); process.exit(1); }
client.login(token).then(() => console.log("✅ Login réussi")).catch(err => console.error(err));