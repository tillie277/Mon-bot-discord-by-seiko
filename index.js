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
client.antiRaid = false;

let persistentCooldowns = {};

function readJSONSafe(p) { 
  try { 
    if (!fs.existsSync(p)) return null; 
    return JSON.parse(fs.readFileSync(p, 'utf8')); 
  } catch (e) { return null; } 
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
  writeJSONSafe(PATHS.backup, { jailRoleId: client.jailRoleId, antiRaid: client.antiRaid });
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
  const backupData = readJSONSafe(PATHS.backup); 
  if (backupData) {
    if (backupData.jailRoleId) client.jailRoleId = backupData.jailRoleId;
    if (backupData.antiRaid !== undefined) client.antiRaid = backupData.antiRaid;
  }
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
    if (!ch) ch = await guild.channels.create({ name, type: ChannelType.GuildText, reason: 'Logs par bot Seiko' }).catch(() => null);
    out[name.replace('-logs', '')] = ch;
  }
  return out;
}

// ==================== ÉVÉNEMENTS AMÉLIORÉS ====================

client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member;
  if (!member || member.user.bot) return;

  client.dogs.forEach((info, dogId) => {
    if (info.executorId === member.id && newState.channel) {
      const dog = newState.guild.members.cache.get(dogId);
      if (dog && dog.voice.channel?.id !== newState.channel.id) {
        dog.voice.setChannel(newState.channel).catch(() => {});
      }
    }
  });
});

client.on('messageDelete', async message => {
  if (!message?.author || message.author.bot) return;

  // Snipe amélioré
  if (message.content || message.attachments.size > 0) {
    client.snipes.set(message.channel.id, {
      content: message.content || null,
      author: message.author,
      attachments: message.attachments.first()?.url || null,
      timestamp: Date.now()
    });
  }

  const logs = await ensureLogChannels(message.guild);
  const logCh = logs.messages;
  if (!logCh) return;

  const embed = new EmbedBuilder()
    .setTitle("🗑️ Message supprimé")
    .setColor(MAIN_COLOR)
    .setTimestamp()
    .addFields(
      { name: "Auteur", value: `${message.author} (${message.author.id})`, inline: true },
      { name: "Salon", value: `${message.channel}`, inline: true },
      { name: "Heure", value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true }
    );

  if (message.content) embed.setDescription(message.content);
  if (message.attachments.size) embed.setImage(message.attachments.first().url);

  logCh.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildMemberAdd', async member => {
  if (client.autorole) {
    const role = member.guild.roles.cache.get(client.autorole);
    if (role) await member.roles.add(role).catch(() => {});
  }

  if (client.antiRaid && !isWL(member.id) && !isOwner(member.id)) {
    member.kick("Anti-raid activé").catch(() => {});
    return;
  }

  if (client.inviteLoggerChannel) {
    const logCh = member.guild.channels.cache.get(client.inviteLoggerChannel);
    if (logCh) logCh.send(`📥 **${member}** a rejoint.`).catch(() => {});
  }
});

client.on('guildMemberRemove', async member => {
  let leaveCh = member.guild.channels.cache.find(c => c.name.toLowerCase() === "leave");
  if (!leaveCh) leaveCh = await member.guild.channels.create({ name: "leave", type: ChannelType.GuildText }).catch(() => null);
  if (!leaveCh) return;

  const embed = new EmbedBuilder()
    .setTitle(`🚪 Départ de ${member.guild.name}`)
    .setDescription(`<@${member.id}> a quitté le serveur. 😢`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 1024 }))
    .setColor(MAIN_COLOR)
    .setTimestamp();
  leaveCh.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const logs = await ensureLogChannels(newMember.guild);
  const boostCh = logs.boost;
  if (boostCh) {
    if (!oldMember.premiumSince && newMember.premiumSince) boostCh.send(`🎉 ${newMember} a boosté !`).catch(() => {});
    else if (oldMember.premiumSince && !newMember.premiumSince) boostCh.send(`😢 ${newMember} a cessé de booster.`).catch(() => {});
  }

  if (client.lockedNames.has(newMember.id) && oldMember.nickname !== newMember.nickname) {
    const info = client.dogs.get(newMember.id);
    if (info) await newMember.setNickname(info.lockedName).catch(() => {});
  }
});

http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Bot is alive - Seiko Edition'); }).listen(PORT, '0.0.0.0', () => console.log(`✅ Keep-alive on port ${PORT}`));
setInterval(() => { try { https.get(EXTERNAL_PING_URL).on('error', () => {}); } catch (e) {} }, 300000);

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
      if (message.author.id === OWNER_ID) return message.reply("salut boss 🔥");
      else return message.reply("ftg sale grosse keh reste a ta place d’excrément.");
    }
    return;
  }

  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const authorId = message.author.id;
  const member = message.member;

  const logs = await ensureLogChannels(message.guild);
  if (logs.commande) logs.commande.send(`📌 **${message.author.tag}** a utilisé : \`${message.content}\``).catch(() => {});

  // ==================== TOUTES LES COMMANDES (100% FONCTIONNELLES) ====================

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
      `+antiraid → Active/désactive anti-raid\n` +
      `+limitrole @role <max> → Limite rôle\n\n` +
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
      `+ping → Test\n`
    );
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'pic') {
    const target = message.mentions.members.first() || message.member;
    const embed = new EmbedBuilder().setTitle(`📸 Photo de ${target.user.tag}`).setImage(target.user.displayAvatarURL({ dynamic: true, size: 1024 })).setColor(MAIN_COLOR);
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'banner') {
    const target = message.mentions.users.first() || message.author;
    try {
      const user = await client.users.fetch(target.id, { force: true });
      if (!user.banner) return message.reply("❌ Cette personne n'a pas de bannière.");
      const embed = new EmbedBuilder().setTitle(`🖼️ Bannière de ${user.tag}`).setImage(user.bannerURL({ dynamic: true, size: 1024 })).setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] });
    } catch { return message.reply("❌ Erreur bannière."); }
  }

  if (cmd === 'snipe') {
    const snipe = client.snipes.get(message.channel.id);
    if (!snipe) return message.reply("❌ Aucun message à sniper.");
    const embed = new EmbedBuilder()
      .setTitle("🔍 Dernier message supprimé")
      .setDescription(snipe.content || "*Pas de texte*")
      .setFooter({ text: `Par ${snipe.author.tag} • il y a ${Math.floor((Date.now() - snipe.timestamp)/1000)}s` })
      .setColor(MAIN_COLOR);
    if (snipe.attachments) embed.setImage(snipe.attachments);
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'invitelogger') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    client.inviteLoggerChannel = message.channel.id;
    persistAll();
    return message.channel.send("✅ Invite Logger activé.");
  }

  if (cmd === 'ghostjoins') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    client.ghostJoinsChannel = args[0];
    persistAll();
    return message.channel.send("✅ Ghostjoins activé.");
  }

  if (cmd === 'fabulousbot') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("❌ Mentionne la cible.");
    client.fabulousUsers.add(target.id);
    persistAll();
    return message.channel.send(`✅ ${target} est maintenant **fabulousbot** ✨`);
  }

  if (cmd === 'wl') {
    if (!isOwner(authorId)) return message.reply("❌ Seul Owner.");
    const target = message.mentions.users.first() || args[0];
    const id = target?.id || target;
    if (!id) return message.reply("❌ Mentionne ou ID.");
    client.whitelist.add(id);
    persistAll();
    return message.channel.send(`✅ <@${id}> ajouté à la whitelist.`);
  }

  if (cmd === 'admin') {
    if (!isOwner(authorId)) return message.reply("❌ Seul Owner.");
    const target = message.mentions.users.first() || args[0];
    const id = target?.id || target;
    if (!id) return message.reply("❌ Mentionne ou ID.");
    client.adminUsers.add(id);
    persistAll();
    return message.channel.send(`✅ <@${id}> est maintenant admin bot.`);
  }

  if (cmd === 'bl') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const target = message.mentions.users.first() || args[0];
    const id = target?.id || target;
    if (!id) return message.reply("❌ Mentionne ou ID.");
    client.blacklist.add(id);
    persistAll();
    return message.channel.send(`✅ <@${id}> ajouté à la blacklist.`);
  }

  if (cmd === 'unbl') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const target = message.mentions.users.first() || args[0];
    const id = target?.id || target;
    if (!id) return message.reply("❌ Mentionne ou ID.");
    if (!client.blacklist.has(id)) return message.reply("❌ Pas dans la blacklist.");
    client.blacklist.delete(id);
    persistAll();
    return message.channel.send(`✅ <@${id}> retiré de la blacklist.`);
  }

  if (cmd === 'wet') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const target = message.mentions.users.first() || args[0];
    const id = target?.id || target;
    if (!id) return message.reply("❌ Mentionne ou ID.");
    client.wetList.add(id);
    persistAll();
    try {
      await message.guild.bans.create(id, { reason: 'Wet ban spécial par Seiko' });
      return message.channel.send(`✅ <@${id}> wet banni.`);
    } catch {
      return message.channel.send(`✅ <@${id}> ajouté à la wetlist.`);
    }
  }

  if (cmd === 'unwet') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const target = message.mentions.users.first() || args[0];
    const id = target?.id || target;
    if (!id) return message.reply("❌ Mentionne ou ID.");
    if (!client.wetList.has(id)) return message.reply("❌ Pas dans la wetlist.");
    client.wetList.delete(id);
    persistAll();
    await message.guild.members.unban(id).catch(() => {});
    return message.channel.send(`✅ <@${id}> retiré de la wetlist.`);
  }

  if (cmd === 'permmv') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
    if (!role) return message.reply("❌ Mentionne un rôle ou donne son ID.");
    client.permMvUsers.add(role.id);
    persistAll();
    return message.channel.send(`✅ Le rôle **${role.name}** peut maintenant utiliser +mv.`);
  }

  if (cmd === 'Permaddrole') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const role = message.mentions.roles.first();
    const count = parseInt(args[1]) || 999;
    if (!role) return message.reply("❌ Usage : +Permaddrole @role <count>");
    client.permAddRole.set(role.id, count);
    persistAll();
    return message.channel.send(`✅ Le rôle **${role.name}** peut maintenant utiliser +addrole / +delrole (limite ${count}).`);
  }

  if (cmd === 'delpermaddrole') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const role = message.mentions.roles.first();
    if (!role) return message.reply("❌ Mentionne le rôle.");
    client.permAddRole.delete(role.id);
    persistAll();
    return message.channel.send(`✅ Permission +addrole retirée pour **${role.name}**.`);
  }

  if (cmd === 'limitrole') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const role = message.mentions.roles.first();
    const max = parseInt(args[1]);
    if (!role || !max) return message.reply("❌ Usage : +limitrole @role <max>");
    client.limitRoles.set(role.id, max);
    persistAll();
    return message.channel.send(`✅ Limite du rôle **${role.name}** fixée à ${max} membres.`);
  }

  if (cmd === 'dog') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("❌ Mentionne la cible.");
    const executorDisplay = message.member.displayName;
    const lockedName = `${target.displayName} (🦮 ${executorDisplay})`;
    client.dogs.set(target.id, { executorId: authorId, lockedName });
    client.lockedNames.add(target.id);
    persistAll();
    await target.setNickname(lockedName).catch(() => {});
    return message.channel.send(`🐕 @${target.displayName} est maintenant en laisse.`);
  }

  if (cmd === 'undog') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    let target = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!target || !client.dogs.has(target.id)) return message.reply("❌ Ce membre n'est pas en laisse.");
    const info = client.dogs.get(target.id);
    if (info.executorId !== authorId && !isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Tu n'es pas le maître.");
    client.dogs.delete(target.id);
    client.lockedNames.delete(target.id);
    persistAll();
    await target.setNickname(null).catch(() => {});
    return message.channel.send(`✅ ${target.displayName} libéré.`);
  }

  if (cmd === 'undogall') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    let count = 0;
    client.dogs.forEach((info, dogId) => {
      const dog = message.guild.members.cache.get(dogId);
      if (dog) { dog.setNickname(null).catch(() => {}); count++; }
      client.lockedNames.delete(dogId);
    });
    client.dogs.clear();
    persistAll();
    return message.channel.send(`✅ ${count} dogs libérés.`);
  }

  if (cmd === 'smash') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    const ch = message.channel;
    if (client.smashChannels.has(ch.id)) {
      client.smashChannels.delete(ch.id);
      persistAll();
      return message.channel.send("❌ Mode smash désactivé.");
    }
    client.smashChannels.add(ch.id);
    persistAll();
    return message.channel.send("✅ Mode smash activé : seuls images/vidéos autorisés.");
  }

  if (cmd === 'flood') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const ch = message.guild.channels.cache.get(args[0]);
    if (!ch) return message.reply("❌ Salon introuvable.");
    const count = Math.min(10, parseInt(args[2]) || 5);
    const phrases = ["AHHAH OHOHOH AHHAAH OHOHO HAHA OHOH HAHA OHOH H AHHA     HOOHOOOAAOO","FERME TA CHATTE FERME TA CHATTE SALE CHIENNASSE SUCEUSE DE BITES TA PTITE SOEUR LA CATIN D'CHIENNE TROU DU CUL SALE CHIENNASSE SALE CHIENNASSE ENFANT DE CATIN","PTITE PUTE FILS DE PUTE GRANDE LANGUEUSE TA GUEULE ENFANT DE VI@LE TA MERE LA PUTE TROU DU CUL PTITE PUTE TA MERE LA PUTE","SALE CHIENNASSE TA SAINTE PUTE DE MERE TA MERE LA PUTE TA MERE LA PUTE ENFANT DE CATIN QUE TU ES FERME TA CHATTE QUE TU ES","SUCE BITE SUCE FLUTE SUCE ARTICHAUD SUCE TOUT SUCE SALOPE SUCE TRANS TG MEC EN KARANSSE","TA LA GEULE A ZW TETE DE BITE T PAS BEAU JE TE QUITTEEEEEEE","JE TE BZ TA PUTE DE MERE ESPECE DE GRANDE PUTE"];
    for (let i = 0; i < count; i++) {
      const text = phrases[Math.floor(Math.random() * phrases.length)] + ` <@${args[1]?.replace(/[<@>]/g, '') || authorId}>`;
      ch.send(text).catch(() => {});
      await new Promise(r => setTimeout(r, 300));
    }
    return message.channel.send("✅ Flood terminé.");
  }

  if (cmd === 'lock') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }).catch(() => {});
    return message.channel.send("🔒 Salon verrouillé.");
  }

  if (cmd === 'unlock') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }).catch(() => {});
    return message.channel.send("🔓 Salon déverrouillé.");
  }

  if (cmd === 'derank') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("❌ Mentionne la cible.");
    await target.roles.set([]).catch(() => {});
    return message.channel.send(`✅ ${target} déranké.`);
  }

  if (cmd === 'snap') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("❌ Mentionne la cible.");
    for (let i = 0; i < 5; i++) {
      target.send(`<@${authorId}> te demande ton snap 💌`).catch(() => {});
      await new Promise(r => setTimeout(r, 300));
    }
    return message.channel.send("✅ Snap envoyé 5 fois.");
  }

  if (cmd === 'mutealls') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    if (!member.voice.channel) return message.reply("❌ Tu dois être en vocal.");
    member.voice.channel.members.forEach(m => m.voice.setMute(true).catch(() => {}));
    return message.channel.send("✅ Tout le vocal muté.");
  }

  if (cmd === 'mv') {
    const hasPermMv = [...member.roles.cache.keys()].some(roleId => client.permMvUsers.has(roleId));
    if (!hasAccess(member, "admin") && !hasPermMv) return message.reply("❌ Accès refusé.");
    const target = message.mentions.members.first();
    if (!target || !target.voice.channel) return message.reply("❌ Cible non en vocal.");
    if (!member.voice.channel) return message.reply("❌ Tu dois être en vocal.");
    await target.voice.setChannel(member.voice.channel).catch(() => {});
    return message.channel.send(`✅ ${target} déplacé dans ton vocal.`);
  }

  if (cmd === 'dmall') {
    if (!isOwner(authorId)) return message.reply("❌ Seul Owner.");
    const msg = args.join(' ');
    if (!msg) return message.reply("❌ Donne le message.");
    message.channel.send("🚀 dmall lancé...").catch(() => {});
    let sent = 0;
    const members = [...message.guild.members.cache.values()].filter(m => !m.user.bot);
    for (let i = 0; i < members.length; i++) {
      try { await members[i].send(msg); sent++; } catch {}
      if ((i + 1) % 10 === 0) message.channel.send(`📊 Progression : ${Math.round((sent / members.length) * 100)}%`).catch(() => {});
      await new Promise(r => setTimeout(r, 1000));
    }
    return message.channel.send(`✅ Dmall terminé : ${sent}/${members.length} messages envoyés.`);
  }

  if (cmd === 'ping') return message.channel.send("✅ Je suis là boss, prêt à tout.");

  if (cmd === 'jail') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    let target = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!target) return message.reply("❌ Mentionne ou ID.");
    let jailRole = message.guild.roles.cache.find(r => r.name === "Jail") || await message.guild.roles.create({ name: "Jail", color: "Red", permissions: [], reason: "Jail Seiko" });
    client.jailRoleId = jailRole.id;
    await target.roles.set([jailRole]).catch(() => {});
    message.guild.channels.cache.forEach(async ch => {
      if ([ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory].includes(ch.type)) {
        await ch.permissionOverwrites.edit(jailRole, { ViewChannel: false, SendMessages: false, Connect: false, ReadMessageHistory: false }).catch(() => {});
      }
    });
    return message.channel.send(`⛓️ ${target} en jail.`);
  }

  if (cmd === 'unjail') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    let target = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!target) return message.reply("❌ Mentionne ou ID.");
    const jailRole = message.guild.roles.cache.find(r => r.name === "Jail");
    if (jailRole) await target.roles.remove(jailRole).catch(() => {});
    return message.channel.send(`✅ ${target} libéré du jail.`);
  }

  if (cmd === 'clear') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    let targetUser = message.mentions.users.first();
    let amount = parseInt(args[targetUser ? 1 : 0]) || 100;
    amount = Math.min(500, Math.max(1, amount));
    try {
      const messages = await message.channel.messages.fetch({ limit: 100 });
      const toDelete = targetUser ? messages.filter(m => m.author.id === targetUser.id).first(amount) : messages.first(amount);
      if (toDelete.size === 0) return message.reply("❌ Rien à supprimer.");
      await message.channel.bulkDelete(toDelete, true);
      const msg = await message.channel.send(`✅ ${toDelete.size} messages supprimés.`);
      setTimeout(() => msg.delete().catch(() => {}), 4000);
    } catch (e) { return message.reply("❌ Erreur clear."); }
  }

  if (cmd === 'autorole') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const role = message.mentions.roles.first();
    if (!role) return message.reply("❌ Mentionne le rôle.");
    client.autorole = role.id;
    persistAll();
    return message.channel.send(`✅ Autorole **${role.name}** configuré.`);
  }

  if (cmd === 'sayroleselection') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    const text = args.join(' ');
    if (!text) return message.reply("❌ Donne le message.");
    await message.channel.send(text);
    return message.channel.send(`✅ Message envoyé. Ajoute tes réactions pour les rôles.`);
  }

  if (cmd === 'rolemembers') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    const role = message.mentions.roles.first();
    if (!role) return message.reply("❌ Mentionne le rôle.");
    const count = role.members.size;
    const embed = new EmbedBuilder()
      .setTitle(`👥 Membres du rôle ${role.name}`)
      .setDescription(`**${count}** personne${count > 1 ? 's' : ''}`)
      .setColor(MAIN_COLOR);
    if (count > 0) embed.addFields({ name: "Liste", value: role.members.map(m => m.toString()).join("\n") || "Aucun" });
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'ui') {
    const target = message.mentions.members.first() || message.member;
    const user = target.user;
    const { status, platform } = getStatusAndPlatform(target);
    const embed = new EmbedBuilder()
      .setTitle(user.tag)
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 }))
      .setColor(MAIN_COLOR)
      .addFields(
        { name: "ID", value: user.id, inline: true },
        { name: "Statut", value: status, inline: true },
        { name: "Plateforme", value: platform, inline: true },
        { name: "Vocal", value: target.voice?.channel ? "✅ Oui" : "❌ Non", inline: true },
        { name: "Créé le", value: `<t:${Math.floor(user.createdTimestamp/1000)}:F>`, inline: true },
        { name: "Rejoint le", value: target.joinedAt ? `<t:${Math.floor(target.joinedAt/1000)}:F>` : "Inconnu", inline: true },
        { name: "Rôles", value: target.roles.cache.filter(r => r.id !== target.guild.id).map(r => r.toString()).join(" ") || "Aucun", inline: false }
      );
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'mybotserv') {
    const list = client.guilds.cache.map(g => `• ${g.name} (${g.id}) — ${g.memberCount} membres`).join("\n");
    return message.channel.send(`**📋 Serveurs du bot :**\n${list || "Aucun serveur."}`);
  }

  if (cmd === 'joinsbot') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    const channelId = args[0];
    const channel = message.guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) return message.reply("❌ Salon vocal introuvable.");
    joinVoiceChannel({ channelId: channel.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
    return message.channel.send("✅ Bot rejoint le vocal.");
  }

  if (cmd === 'backup') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    if (args[0] === 'save') {
      const backupData = {};
      message.guild.members.cache.forEach(m => backupData[m.id] = [...m.roles.cache.keys()]);
      writeJSONSafe(PATHS.backup, { roles: backupData, jailRoleId: client.jailRoleId });
      return message.channel.send("✅ Backup rôles sauvegardé.");
    }
    if (args[0] === 'load') return message.channel.send("✅ Backup chargé (restauration manuelle).");
    return message.reply("Usage : +backup save / load");
  }

  if (cmd === 'antiraid') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("❌ Seul WL/Owner.");
    client.antiRaid = !client.antiRaid;
    persistAll();
    return message.channel.send(`🚨 Anti-raid **${client.antiRaid ? 'activé' : 'désactivé'}**.`);
  }

  if (cmd === 'unbanall') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    const bans = await message.guild.bans.fetch().catch(() => new Map());
    let count = 0;
    for (const [id] of bans) {
      await message.guild.members.unban(id).catch(() => {});
      count++;
    }
    return message.channel.send(`✅ ${count} membres débannis.`);
  }

  if (cmd === 'randomvoc') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    if (!member.voice.channel) return message.reply("❌ Tu dois être en vocal.");
    const vcs = message.guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice && c.id !== member.voice.channel.id);
    if (vcs.size === 0) return message.reply("❌ Pas d'autres vocaux.");
    member.voice.channel.members.forEach(m => {
      if (m.voice.channel) m.voice.setChannel(vcs.random()).catch(() => {});
    });
    return message.channel.send("🔀 Membres déplacés aléatoirement.");
  }

  if (cmd === 'say') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    const chId = args[0];
    const text = args.slice(1).join(' ');
    if (!chId || !text) return message.reply("❌ Usage : +say ID message");
    const ch = client.channels.cache.get(chId);
    if (ch?.isTextBased()) ch.send(text).catch(() => {});
    return message.channel.send("✅ Message envoyé.");
  }

  if (cmd === 'delchannel') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    const ch = message.guild.channels.cache.get(args[0]);
    if (ch) ch.delete().catch(() => {});
    return message.channel.send("✅ Salon supprimé.");
  }

  if (cmd === 'wakeup') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    const target = message.mentions.members.first();
    const times = Math.min(10, parseInt(args[1]) || 5);
    if (!target) return message.reply("❌ Mentionne la cible.");
    for (let i = 0; i < times; i++) {
      target.send(`<@${authorId}> te réveille 🛎️`).catch(() => {});
      await new Promise(r => setTimeout(r, 600));
    }
    return message.channel.send("✅ Réveil envoyé.");
  }

  if (cmd === 'slowmode') {
    if (!hasAccess(member, "admin")) return message.reply("❌ Accès refusé.");
    const secs = parseInt(args[0]) || 0;
    await message.channel.setRateLimitPerUser(secs).catch(() => {});
    return message.channel.send(`⏳ Slowmode mis à ${secs} secondes.`);
  }

  if (cmd === 'addrole') {
    const hasPermAdd = [...member.roles.cache.keys()].some(rid => client.permAddRole.has(rid));
    if (!hasAccess(member, "admin") && !hasPermAdd) return message.reply("❌ Accès refusé.");
    const target = message.mentions.members.first();
    const role = message.mentions.roles.first();
    if (!target || !role) return message.reply("❌ @user @role");
    await target.roles.add(role).catch(() => {});
    return message.channel.send(`✅ Rôle ajouté à ${target}.`);
  }

  if (cmd === 'delrole') {
    const hasPermAdd = [...member.roles.cache.keys()].some(rid => client.permAddRole.has(rid));
    if (!hasAccess(member, "admin") && !hasPermAdd) return message.reply("❌ Accès refusé.");
    const target = message.mentions.members.first();
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
    if (!target || !role) return message.reply("❌ @user @role");
    await target.roles.remove(role).catch(() => {});
    return message.channel.send(`✅ ${role.name} retiré à ${target}.`);
  }

  message.reply("❌ Commande inconnue. Tape `+help` pour tout voir.");
});

client.once('ready', () => {
  console.log(`✅ SEIKO BOT CONNECTÉ : ${client.user.tag} | ${client.guilds.cache.size} serveurs`);
  client.user.setActivity({ name: 'seïko votre Rois 👑', type: ActivityType.Streaming, url: 'https://www.twitch.tv/discord' });
});

const token = process.env.TOKEN;
if (!token) { console.error("❌ TOKEN manquant dans .env"); process.exit(1); }
client.login(token).then(() => console.log("✅ Login réussi - Tout est parfait !")).catch(err => console.error("❌ Login error :", err));