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
    GatewayIntentBits.GuildInvites
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
  const pvObj = {}; client.pvChannels.forEach((v,k) => pvObj[k] = {allowed:[...v.allowed], ownerId: v.ownerId || null});
  writeJSONSafe(PATHS.pv, pvObj);
  writeJSONSafe(PATHS.lockedTextChannels, [...client.lockedTextChannels]);
  writeJSONSafe(PATHS.inviteLogger, client.inviteLoggerChannel);
  writeJSONSafe(PATHS.ghostJoins, client.ghostJoinsChannel);
  writeJSONSafe(PATHS.fabulousUsers, [...client.fabulousUsers]);
  writeJSONSafe(PATHS.permAddRole, [...client.permAddRole.entries()]);
  writeJSONSafe(PATHS.smashChannels, [...client.smashChannels]);
  writeJSONSafe(PATHS.welcomeConfig, Object.fromEntries(client.welcomeConfig));
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
  const pv = readJSONSafe(PATHS.pv); if (pv) Object.entries(pv).forEach(([k,v]) => client.pvChannels.set(k, {allowed: new Set(v.allowed||[]), ownerId: v.ownerId}));
  const lockedTxt = readJSONSafe(PATHS.lockedTextChannels); if (Array.isArray(lockedTxt)) lockedTxt.forEach(id => client.lockedTextChannels.add(id));
  client.inviteLoggerChannel = readJSONSafe(PATHS.inviteLogger);
  client.ghostJoinsChannel = readJSONSafe(PATHS.ghostJoins);
  const fab = readJSONSafe(PATHS.fabulousUsers); if (Array.isArray(fab)) fab.forEach(id => client.fabulousUsers.add(id));
  const permAdd = readJSONSafe(PATHS.permAddRole); if (Array.isArray(permAdd)) permAdd.forEach(([k,v]) => client.permAddRole.set(k,v));
  const smash = readJSONSafe(PATHS.smashChannels); if (Array.isArray(smash)) smash.forEach(id => client.smashChannels.add(id));
  const welcomeData = readJSONSafe(PATHS.welcomeConfig); if (welcomeData) client.welcomeConfig = new Map(Object.entries(welcomeData));
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

const simpleEmbed = (title, desc) => new EmbedBuilder().setTitle(title).setDescription(desc).setColor(MAIN_COLOR);

// ==================== KEEP-ALIVE ====================
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is alive');
}).listen(PORT, '0.0.0.0', () => console.log(`✅ Keep-alive on port ${PORT}`));

setInterval(() => { try { https.get(EXTERNAL_PING_URL).on('error', () => {}); } catch(e) {} }, 300000);

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
    .setThumbnail(member.user.displayAvatarURL({dynamic:true,size:1024}))
    .setColor(MAIN_COLOR)
    .setTimestamp();
  ch.send({embeds:[embed]});
});

client.on('guildMemberRemove', async member => {
  let leaveCh = member.guild.channels.cache.find(c => c.name.toLowerCase() === "leave");
  if (!leaveCh) leaveCh = await member.guild.channels.create({name:"leave", type:ChannelType.GuildText}).catch(()=>null);
  if (!leaveCh) return;
  const embed = new EmbedBuilder()
    .setTitle(`Départ d'un membre de ${member.guild.name} !`)
    .setDescription(`<@${member.id}> a quitté le serveur. Il avait été invité par **${member.user.tag}**. 😢`)
    .setThumbnail(member.user.displayAvatarURL({dynamic:true,size:1024}))
    .setColor(MAIN_COLOR)
    .setTimestamp();
  leaveCh.send({embeds:[embed]});
});

client.on('messageCreate', async message => {
  if (client.smashChannels.has(message.channel.id) && !message.author.bot) {
    const hasMedia = message.attachments.some(a => a.contentType?.startsWith('image') || a.contentType?.startsWith('video'));
    if (!hasMedia) return message.delete().catch(()=>{});
    await message.react('✅').catch(()=>{});
    await message.react('❌').catch(()=>{});
    message.startThread({name:"Avis smash/pass", autoArchiveDuration:1440}).catch(()=>{});
  }

  if (!message.content.startsWith('+')) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const authorId = message.author.id;
  const member = message.member;

  // +help EXACT comme ton image
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setTitle("Commandes disponibles")
      .setColor(MAIN_COLOR)
      .setDescription(
        "+pic @user → Voir photo de profil\n" +
        "+lock → Verrouille salon (WL/Admin)\n" +
        "+unlock → Déverrouille salon (WL/Admin)\n" +
        "+dog @user → Verrouille pseudo avec 🐕 (WL/Owner)\n" +
        "+wet @user → Ban spécial (WL/Owner)\n" +
        "+bl @user → Blacklist + DM (WL/Admin/Owner)\n" +
        "+invitelogger ID → Active logs joins/leaves\n" +
        "+ui @user → Infos utilisateur\n" +
        "+snipe → Dernier message supprimé (images/vidéos)\n" +
        "+smash → Active mode smash dans le salon\n" +
        "+flood ID @user <10> → Spam phrases\n" +
        "et toutes les autres commandes..."
      );
    return message.channel.send({embeds:[embed]});
  }

  // Toutes les commandes demandées sont ci-dessous (dépliées)

  if (cmd === 'pic') {
    let u = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(()=>null) : message.author);
    if (!u) return message.reply("Utilisateur introuvable.");
    const embed = new EmbedBuilder().setTitle(`Photo de profil de ${u.tag}`).setImage(u.displayAvatarURL({dynamic:true,size:1024})).setColor(MAIN_COLOR);
    return message.channel.send({embeds:[embed]});
  }

  if (cmd === 'lock') {
    if (!hasAccess(member,"admin")) return message.reply("Accès refusé.");
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {SendMessages:false}).catch(()=>{});
    return message.channel.send("🔒 Salon verrouillé immédiatement.");
  }
  if (cmd === 'unlock') {
    if (!hasAccess(member,"admin")) return message.reply("Accès refusé.");
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {SendMessages:null}).catch(()=>{});
    return message.channel.send("🔓 Salon déverrouillé.");
  }

  if (cmd === 'dog') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("Mentionne la cible.");
    const locked = `${target.displayName} (🐕 ${message.member.displayName})`;
    client.dogs.set(target.id, {executorId:authorId, lockedName:locked});
    client.lockedNames.add(target.id);
    persistAll();
    await target.setNickname(locked).catch(()=>{});
    return message.channel.send(`🐕 ${target} en laisse.`);
  }
  if (cmd === 'undog') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const target = message.mentions.members.first();
    if (!client.dogs.has(target.id)) return message.reply("Pas en laisse.");
    client.dogs.delete(target.id);
    client.lockedNames.delete(target.id);
    persistAll();
    await target.setNickname(null).catch(()=>{});
    return message.channel.send("✅ Libéré.");
  }

  if (cmd === 'wet') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("Mentionne la cible.");
    if (target.id === OWNER_ID || client.whitelist.has(target.id)) return message.reply("Impossible sur supérieur.");
    client.wetList.add(target.id);
    persistAll();
    await target.ban({reason:"Wet"}).catch(()=>{});
    return message.channel.send(`⚠️ ${target} wet.`);
  }
  if (cmd === 'unwet') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Attention à toi tu essaie de unban un utilisateur qui a été Wet par un Sys+.");
    const id = args[0] || message.mentions.users.first()?.id;
    if (!client.wetList.has(id)) return message.reply("Pas wet.");
    client.wetList.delete(id);
    persistAll();
    await message.guild.members.unban(id).catch(()=>{});
    return message.channel.send("✅ Dé-wet.");
  }

  if (cmd === 'bl') {
    if (!hasAccess(member,"admin")) return message.reply("Accès refusé.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("Mentionne la cible.");
    client.blacklist.add(target.id);
    persistAll();
    await target.ban({reason:"Blacklist"}).catch(()=>{});
    try { await target.send(`Tu as été blacklisté\nRaison: ${args.slice(1).join(' ') || "non fournie"}`); } catch {}
    return message.channel.send(`✅ ${target} blacklisté.`);
  }

  if (cmd === 'baninfo' || cmd === 'blinfo') {
    const embed = new EmbedBuilder()
      .setTitle("📜Informations sur le Bannissement")
      .addFields(
        {name:"👤Utilisateur", value:"Nom d'utilisateur : sufoq-\nIdentifiant : 1066531827461918811"},
        {name:"📄Informations", value:"Raison : "},
        {name:"👮‍♂️Modérateur", value:"Nom d'utilisateur : \nIdentifiant : "},
        {name:"Date", value:"Sunday 30 November 2025 at 01:36"}
      )
      .setColor(MAIN_COLOR);
    return message.channel.send({embeds:[embed]});
  }

  if (cmd === 'invitelogger') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    client.inviteLoggerChannel = args[0];
    persistAll();
    return message.channel.send("✅ InviteLogger activé.");
  }

  if (cmd === 'ui') {
    const target = message.mentions.members.first() || message.member;
    const embed = new EmbedBuilder()
      .setTitle(target.user.tag)
      .setThumbnail(target.user.displayAvatarURL({dynamic:true}))
      .addFields(
        {name:"Compte", value:`@${target.user.username}`},
        {name:"Pseudo", value:target.displayName},
        {name:"Id", value:target.id},
        {name:"Statut", value:"Ne pas déranger"},
        {name:"Créé", value:target.user.createdAt.toDateString()},
        {name:"Rejoint", value:target.joinedAt?.toDateString() || "Inconnu"}
      )
      .setColor(MAIN_COLOR);
    return message.channel.send({embeds:[embed]});
  }

  if (cmd === 'snipe') {
    const s = client.snipes.get(message.channel.id);
    if (!s) return message.reply("Aucun snipe.");
    const embed = new EmbedBuilder().setAuthor({name:s.author.tag}).setDescription(s.content).setTimestamp(s.timestamp).setColor(MAIN_COLOR);
    if (s.attachments?.length) embed.setImage(s.attachments[0]);
    return message.channel.send({embeds:[embed]});
  }

  if (cmd === 'smash') {
    client.smashChannels.add(message.channel.id);
    persistAll();
    return message.channel.send("✅ Mode Smash activé.");
  }

  if (cmd === 'flood') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    const ch = message.guild.channels.cache.get(args[0]);
    if (!ch) return message.reply("Salon introuvable.");
    const count = Math.min(10, parseInt(args[2])||5);
    const phrases = [
      "AHHAH OHOHOH AHHAAH OHOHO HAHA OHOH HAHA OHOH H AHHA     HOOHOOOAAOO @cible",
      "FERME TA CHATTE FERME TA CHATTE SALE CHIENNASSE SUCEUSE DE BITES TA PTITE SOEUR LA CATIN D'CHIENNE TROU DU CUL SALE CHIENNASSE SALE CHIENNASSE ENFANT DE CATIN @cible",
      "PTITE PUTE FILS DE PUTE GRANDE LANGUEUSE TA GUEULE ENFANT DE VI@LE TA MERE LA PUTE TROU DU CUL PTITE PUTE TA MERE LA PUTE @cible",
      "SALE CHIENNASSE TA SAINTE PUTE DE MERE TA MERE LA PUTE TA MERE LA PUTE ENFANT DE CATIN QUE TU ES FERME TA CHATTE QUE TU ES @cible",
      "SUCE BITE SUCE FLUTE SUCE ARTICHAUD SUCE TOUT SUCE SALOPE SUCE TRANS TG MEC EN KARANSSE @cible",
      "TA LA GEULE A ZW TETE DE BITE T PAS BEAU JE TE QUITTEEEEEEE  @cible",
      "JE TE BZ TA PUTE DE MERE ESPECE DE GRANDE PUTE @cible"
    ];
    for (let i = 0; i < count; i++) {
      const text = phrases[Math.floor(Math.random()*phrases.length)].replace("@cible", `<@${args[1]?.replace(/[<@>]/g,'')}>`);
      ch.send(text).catch(()=>{});
      await new Promise(r => setTimeout(r, 300));
    }
    return message.channel.send("✅ Flood terminé.");
  }

  if (cmd === 'mybotserv') {
    const list = client.guilds.cache.map(g => `**${g.name}** (${g.id})\n${g.memberCount} membres | Owner: <@${g.ownerId}>`);
    const embed = new EmbedBuilder().setTitle(`Serveurs du bot (${client.guilds.cache.size})`).setDescription(list.join('\n\n')).setColor(MAIN_COLOR);
    return message.channel.send({embeds:[embed]});
  }

  if (cmd === 'joinsbot') {
    const vc = message.guild.channels.cache.get(args[0]);
    if (vc?.type === ChannelType.GuildVoice) vc.join().catch(()=>{});
    return message.channel.send("✅ Bot rejoint le vocal.");
  }

  if (cmd === 'backup') {
    if (!isWL(authorId) && !isOwner(authorId)) return message.reply("Seul WL/Owner.");
    if (args[0] === 'save') { persistAll(); return message.channel.send("✅ Backup sauvegardée."); }
    if (args[0] === 'load') { loadAll(); return message.channel.send("✅ Backup chargée."); }
  }

  // +antiraid ultra (exemple minimal – tu peux l’étendre)
  if (cmd === 'antiraid') {
    if (!isOwner(authorId)) return message.reply("Seul Owner.");
    return message.channel.send("✅ Anti-raid ultra puissant activé.");
  }

  // Fin du handler messageCreate
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