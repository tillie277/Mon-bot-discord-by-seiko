require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  ActivityType,
  SlashCommandBuilder
} = require('discord.js');

// ============================================================
//  CONFIGURATION GÉNÉRALE
// ============================================================
const PREFIX = '+';
const MAIN_COLOR = '#8A2BE2';
const OWNER_ID = '685679698054742017'; // ID de l'Owner principal du bot
const DATA_DIR = path.resolve(__dirname, 'data');
const GIVEAWAY_EMOJI = '🎉';
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // limite Discord : 28 jours

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const PATHS = {
  whitelist: path.join(DATA_DIR, 'whitelist.json'),
  admin: path.join(DATA_DIR, 'admin.json'),
  ownerBots: path.join(DATA_DIR, 'ownerBots.json'),
  blacklist: path.join(DATA_DIR, 'blacklist.json'),
  wetList: path.join(DATA_DIR, 'wetList.json'),
  jailedMembers: path.join(DATA_DIR, 'jailedMembers.json'),
  permMvRoles: path.join(DATA_DIR, 'permMvRoles.json'),
  limitRoles: path.join(DATA_DIR, 'limitRoles.json'),
  inviteLogger: path.join(DATA_DIR, 'inviteLogger.json'),
  ghostJoins: path.join(DATA_DIR, 'ghostJoins.json'),
  fabulousUsers: path.join(DATA_DIR, 'fabulousUsers.json'),
  permAddRole: path.join(DATA_DIR, 'permAddRole.json'),
  permImageRoles: path.join(DATA_DIR, 'permImageRoles.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  rolesBackup: path.join(DATA_DIR, 'rolesBackup.json'),
  autorole: path.join(DATA_DIR, 'autorole.json'),
  roleLocks: path.join(DATA_DIR, 'roleLocks.json'),
  ultraLock: path.join(DATA_DIR, 'ultraLock.json'),
  warns: path.join(DATA_DIR, 'warns.json'),
  forceRoles: path.join(DATA_DIR, 'forceRoles.json'),
  giveaways: path.join(DATA_DIR, 'giveaways.json'),
};

const PORT = process.env.PORT || 10000;
const EXTERNAL_PING_URL = process.env.PING_URL || 'https://mon-bot-discord-by-seiko.onrender.com/';

// ============================================================
//  CLIENT DISCORD
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
  ]
});

// ============================================================
//  DONNÉES EN MÉMOIRE
// ============================================================
client.whitelist = new Set();
client.adminUsers = new Set();
client.ownerBots = new Set();
client.blacklist = new Set();
client.wetList = new Set();
client.jailedMembers = new Set();
client.permMvRoles = new Set();
client.limitRoles = new Map();      // roleId -> nombre max de membres
client.inviteLoggerChannel = null;
client.ghostJoinsChannel = null;
client.fabulousUsers = new Set();
client.permAddRole = new Map();     // roleId -> info (nombre)
client.permImageRoles = new Set();
client.jailRoleId = null;
client.autorole = null;
client.antiRaid = false;
client.roleLocks = new Map();       // roleId -> userId (verrouilleur)
client.ultraLock = { active: false, channelId: null, lockerUserId: null };
client.warns = new Map();           // userId -> [{ reason, moderatorId, timestamp }]
client.forceRoles = new Map();      // userId -> [roleId, ...]
client.giveaways = new Map();       // messageId -> { channelId, guildId, prize, winnersCount, endTime, hostId, ended }
client.snipes = new Map();
client.joinTimestamps = new Map();  // userId -> timestamp (détection ghost joins, non persistant)

// ============================================================
//  UTILITAIRES JSON
// ============================================================
const readJSONSafe = (p) => {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { return null; }
};

const writeJSONSafe = (p, data) => {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch (e) {}
};

// ============================================================
//  PERSISTANCE
// ============================================================
function persistAll() {
  writeJSONSafe(PATHS.whitelist, [...client.whitelist]);
  writeJSONSafe(PATHS.admin, [...client.adminUsers]);
  writeJSONSafe(PATHS.ownerBots, [...client.ownerBots]);
  writeJSONSafe(PATHS.blacklist, [...client.blacklist]);
  writeJSONSafe(PATHS.wetList, [...client.wetList]);
  writeJSONSafe(PATHS.jailedMembers, [...client.jailedMembers]);
  writeJSONSafe(PATHS.permMvRoles, [...client.permMvRoles]);
  writeJSONSafe(PATHS.limitRoles, [...client.limitRoles.entries()]);
  writeJSONSafe(PATHS.inviteLogger, client.inviteLoggerChannel);
  writeJSONSafe(PATHS.ghostJoins, client.ghostJoinsChannel);
  writeJSONSafe(PATHS.fabulousUsers, [...client.fabulousUsers]);
  writeJSONSafe(PATHS.permAddRole, [...client.permAddRole.entries()]);
  writeJSONSafe(PATHS.permImageRoles, [...client.permImageRoles]);
  writeJSONSafe(PATHS.settings, { jailRoleId: client.jailRoleId, antiRaid: client.antiRaid });
  writeJSONSafe(PATHS.autorole, client.autorole);
  writeJSONSafe(PATHS.roleLocks, [...client.roleLocks.entries()]);
  writeJSONSafe(PATHS.ultraLock, client.ultraLock);
  writeJSONSafe(PATHS.warns, [...client.warns.entries()]);
  writeJSONSafe(PATHS.forceRoles, [...client.forceRoles.entries()]);
  writeJSONSafe(PATHS.giveaways, [...client.giveaways.entries()]);
}

function loadAll() {
  const wl = readJSONSafe(PATHS.whitelist); if (Array.isArray(wl)) wl.forEach(id => client.whitelist.add(id));
  const adm = readJSONSafe(PATHS.admin); if (Array.isArray(adm)) adm.forEach(id => client.adminUsers.add(id));
  const ob = readJSONSafe(PATHS.ownerBots); if (Array.isArray(ob)) ob.forEach(id => client.ownerBots.add(id));
  const bl = readJSONSafe(PATHS.blacklist); if (Array.isArray(bl)) bl.forEach(id => client.blacklist.add(id));
  const wet = readJSONSafe(PATHS.wetList); if (Array.isArray(wet)) wet.forEach(id => client.wetList.add(id));
  const jm = readJSONSafe(PATHS.jailedMembers); if (Array.isArray(jm)) jm.forEach(id => client.jailedMembers.add(id));
  const pmv = readJSONSafe(PATHS.permMvRoles); if (Array.isArray(pmv)) pmv.forEach(id => client.permMvRoles.add(id));
  const lr = readJSONSafe(PATHS.limitRoles); if (Array.isArray(lr)) lr.forEach(([k, v]) => client.limitRoles.set(k, v));
  client.inviteLoggerChannel = readJSONSafe(PATHS.inviteLogger);
  client.ghostJoinsChannel = readJSONSafe(PATHS.ghostJoins);
  const fab = readJSONSafe(PATHS.fabulousUsers); if (Array.isArray(fab)) fab.forEach(id => client.fabulousUsers.add(id));
  const permAdd = readJSONSafe(PATHS.permAddRole); if (Array.isArray(permAdd)) permAdd.forEach(([k, v]) => client.permAddRole.set(k, v));
  const permImg = readJSONSafe(PATHS.permImageRoles); if (Array.isArray(permImg)) permImg.forEach(id => client.permImageRoles.add(id));
  const settings = readJSONSafe(PATHS.settings);
  if (settings) { client.jailRoleId = settings.jailRoleId || null; client.antiRaid = settings.antiRaid ?? false; }
  client.autorole = readJSONSafe(PATHS.autorole) || null;
  const rl = readJSONSafe(PATHS.roleLocks); if (Array.isArray(rl)) rl.forEach(([k, v]) => client.roleLocks.set(k, v));
  const ul = readJSONSafe(PATHS.ultraLock); if (ul) client.ultraLock = ul;
  const warns = readJSONSafe(PATHS.warns); if (Array.isArray(warns)) warns.forEach(([k, v]) => client.warns.set(k, v));
  const fr = readJSONSafe(PATHS.forceRoles); if (Array.isArray(fr)) fr.forEach(([k, v]) => client.forceRoles.set(k, v));
  const gv = readJSONSafe(PATHS.giveaways); if (Array.isArray(gv)) gv.forEach(([k, v]) => client.giveaways.set(k, v));
}

// ============================================================
//  PERMISSIONS — Hiérarchie : Owner > OwnerBot > WL > Admin > Tout le monde
// ============================================================
const isOwner = (id) => id === OWNER_ID;
const isOwnerBot = (id) => isOwner(id) || client.ownerBots.has(id);
const isWL = (id) => isOwnerBot(id) || client.whitelist.has(id);
const isAdminUser = (member) => !!member && (member.permissions?.has(PermissionsBitField.Flags.Administrator) || client.adminUsers.has(member.id));

const hasAccess = (member, level) => {
  if (!member) return false;
  const id = member.id;
  if (level === 'owner') return isOwnerBot(id);
  if (level === 'wl') return isWL(id);
  if (level === 'admin') return isAdminUser(member) || isWL(id);
  return true; // 'everyone'
};

const hasPermImage = (member) => !!member && [...member.roles.cache.keys()].some(id => client.permImageRoles.has(id));
const hasPermMv = (member) => !!member && [...member.roles.cache.keys()].some(id => client.permMvRoles.has(id));
const hasPermAddRole = (member) => !!member && [...member.roles.cache.keys()].some(id => client.permAddRole.has(id));

// ============================================================
//  HELPERS
// ============================================================
async function resolveMember(message, idArg) {
  return message.mentions.members.first() || (idArg ? await message.guild.members.fetch(idArg).catch(() => null) : null);
}

function resolveRole(message, idArg) {
  return message.mentions.roles.first() || (idArg ? message.guild.roles.cache.get(idArg) : null);
}

function getStatusAndPlatform(member) {
  if (!member.presence) return { status: '⚫ Hors ligne', platform: 'Inconnu' };
  const statusMap = { online: '🟢 En ligne', idle: '🟡 Inactif', dnd: '🔴 Ne pas déranger', offline: '⚫ Hors ligne' };
  const statusText = statusMap[member.presence.status] || '⚫ Hors ligne';
  let platform = 'Inconnu';
  if (member.presence.clientStatus) {
    if (member.presence.clientStatus.mobile) platform = 'Mobile';
    else if (member.presence.clientStatus.desktop) platform = 'Ordinateur';
    else if (member.presence.clientStatus.web) platform = 'Web';
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
    if (!ch) ch = await guild.channels.create({ name, type: ChannelType.GuildText, reason: 'Logs du bot' }).catch(() => null);
    out[name.replace('-logs', '')] = ch;
  }
  return out;
}

function parseDuration(str) {
  if (!str) return null;
  const match = /^(\d+)\s*(s|sec|secondes?|m|min|minutes?|h|heures?|d|j|jours?)$/i.exec(str.trim());
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('s')) return value * 1000;
  if (unit.startsWith('m')) return value * 60 * 1000;
  if (unit.startsWith('h')) return value * 60 * 60 * 1000;
  return value * 24 * 60 * 60 * 1000; // d / j / jours
}

function pickRandomWinners(pool, count) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// ============================================================
//  SYSTÈME DE GIVEAWAYS
// ============================================================
async function startGiveaway(channel, hostId, durationStr, winnersCount, prize) {
  const durationMs = parseDuration(durationStr);
  if (!durationMs) throw new Error('Durée invalide. Utilise un format comme 30s, 10m, 1h, 2d.');
  if (!winnersCount || winnersCount < 1) throw new Error('Le nombre de gagnants doit être au moins 1.');
  if (!prize) throw new Error('Indique un prix pour le giveaway.');

  const endTime = Date.now() + durationMs;
  const embed = new EmbedBuilder()
    .setTitle(`🎉 GIVEAWAY : ${prize}`)
    .setDescription(`Réagis avec ${GIVEAWAY_EMOJI} pour participer !\n\n🏆 Gagnants : **${winnersCount}**\n⏰ Fin : <t:${Math.floor(endTime / 1000)}:R>\n👤 Organisé par : <@${hostId}>`)
    .setColor(MAIN_COLOR)
    .setTimestamp(endTime);

  const msg = await channel.send({ embeds: [embed] });
  await msg.react(GIVEAWAY_EMOJI).catch(() => {});

  client.giveaways.set(msg.id, { channelId: channel.id, guildId: channel.guild.id, prize, winnersCount, endTime, hostId, ended: false });
  persistAll();
  return msg;
}

async function endGiveawayById(id, isReroll = false) {
  const data = client.giveaways.get(id);
  if (!data) throw new Error('Giveaway introuvable.');

  const channel = await client.channels.fetch(data.channelId).catch(() => null);
  if (!channel) throw new Error('Salon du giveaway introuvable.');
  const message = await channel.messages.fetch(id).catch(() => null);
  if (!message) throw new Error('Message du giveaway introuvable.');

  let winners = [];
  const reaction = message.reactions.cache.get(GIVEAWAY_EMOJI);
  if (reaction) {
    const users = await reaction.users.fetch().catch(() => null);
    if (users) winners = pickRandomWinners([...users.filter(u => !u.bot).values()], data.winnersCount);
  }

  if (!isReroll) {
    data.ended = true;
    client.giveaways.set(id, data);
    persistAll();
    const endedEmbed = new EmbedBuilder()
      .setTitle(`🎉 GIVEAWAY TERMINÉ : ${data.prize}`)
      .setDescription(winners.length ? `Gagnant(s) : ${winners.map(w => `<@${w.id}>`).join(', ')}` : "Personne n'a participé.")
      .setColor(MAIN_COLOR);
    await message.edit({ embeds: [endedEmbed] }).catch(() => {});
  }

  if (winners.length) {
    await channel.send(`🎉 Félicitations ${winners.map(w => `<@${w.id}>`).join(', ')} ! Vous remportez **${data.prize}** !`).catch(() => {});
  } else {
    await channel.send(`😢 Aucun participant valide pour le giveaway **${data.prize}**.`).catch(() => {});
  }
  return winners;
}

const giveawayCommands = [
  new SlashCommandBuilder()
    .setName('gstart')
    .setDescription('Démarre un giveaway')
    .addStringOption(o => o.setName('duree').setDescription('Ex : 30s, 10m, 1h, 2d').setRequired(true))
    .addIntegerOption(o => o.setName('gagnants').setDescription('Nombre de gagnants').setRequired(true))
    .addStringOption(o => o.setName('prix').setDescription('Le prix à gagner').setRequired(true)),
  new SlashCommandBuilder()
    .setName('gend')
    .setDescription('Termine un giveaway immédiatement')
    .addStringOption(o => o.setName('id').setDescription('ID du giveaway (ID du message)').setRequired(true)),
  new SlashCommandBuilder()
    .setName('greroll')
    .setDescription('Retire un ou plusieurs nouveaux gagnants')
    .addStringOption(o => o.setName('id').setDescription('ID du giveaway').setRequired(true)),
  new SlashCommandBuilder()
    .setName('glist')
    .setDescription('Liste les giveaways en cours'),
].map(c => c.toJSON());

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const isAdminLevel = hasAccess(interaction.member, 'admin');

  try {
    if (interaction.commandName === 'gstart') {
      if (!isAdminLevel) return interaction.reply({ content: '❌ Accès refusé.', ephemeral: true });
      await startGiveaway(interaction.channel, interaction.user.id, interaction.options.getString('duree'), interaction.options.getInteger('gagnants'), interaction.options.getString('prix'));
      return interaction.reply({ content: '✅ Giveaway lancé !', ephemeral: true });
    }
    if (interaction.commandName === 'gend') {
      if (!isAdminLevel) return interaction.reply({ content: '❌ Accès refusé.', ephemeral: true });
      await endGiveawayById(interaction.options.getString('id'));
      return interaction.reply({ content: '✅ Giveaway terminé.', ephemeral: true });
    }
    if (interaction.commandName === 'greroll') {
      if (!isAdminLevel) return interaction.reply({ content: '❌ Accès refusé.', ephemeral: true });
      await endGiveawayById(interaction.options.getString('id'), true);
      return interaction.reply({ content: '✅ Reroll effectué.', ephemeral: true });
    }
    if (interaction.commandName === 'glist') {
      const active = [...client.giveaways.entries()].filter(([, d]) => !d.ended);
      if (!active.length) return interaction.reply({ content: 'Aucun giveaway en cours.', ephemeral: true });
      const desc = active.map(([id, d]) => `🎁 **${d.prize}** — <#${d.channelId}> — fin <t:${Math.floor(d.endTime / 1000)}:R> — ID: \`${id}\``).join('\n');
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎉 Giveaways en cours').setDescription(desc).setColor(MAIN_COLOR)] });
    }
  } catch (e) {
    const payload = { content: `❌ ${e.message}`, ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

// ============================================================
//  EVENTS
// ============================================================
client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member;
  if (!member || member.user.bot) return;

  if (client.ultraLock.active && client.ultraLock.channelId && newState.channelId === client.ultraLock.channelId && !isOwnerBot(member.id)) {
    await member.voice.disconnect().catch(() => {});
    member.send('Ce vocal est privé, tu ne peux pas rejoindre.').catch(() => {});
  }
});

client.on('messageDelete', async message => {
  if (!message?.author || message.author.bot || !message.guild) return;

  if (message.content || message.attachments.size > 0) {
    client.snipes.set(message.channel.id, {
      content: message.content || null,
      author: message.author,
      attachments: message.attachments.first()?.url || null,
      timestamp: Date.now()
    });
  }

  const logs = await ensureLogChannels(message.guild);
  if (!logs.messages) return;

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message supprimé')
    .setColor(MAIN_COLOR)
    .setTimestamp()
    .addFields(
      { name: 'Auteur', value: `${message.author} (${message.author.id})`, inline: true },
      { name: 'Salon', value: `${message.channel}`, inline: true },
      { name: 'Heure', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
    );
  if (message.content) embed.setDescription(message.content);
  if (message.attachments.size) embed.setImage(message.attachments.first().url);
  logs.messages.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildMemberAdd', async member => {
  client.joinTimestamps.set(member.id, Date.now());
  setTimeout(() => client.joinTimestamps.delete(member.id), 5 * 60 * 1000);

  if (client.autorole) {
    const role = member.guild.roles.cache.get(client.autorole);
    if (role) await member.roles.add(role).catch(() => {});
  }

  if (client.antiRaid && !isOwnerBot(member.id)) {
    return member.kick('Anti-raid actif').catch(() => {});
  }

  if (client.wetList.has(member.id)) {
    return member.guild.bans.create(member.id, { reason: 'Wet ban ré-appliqué (retour pendant absence du bot)' }).catch(() => {});
  }

  if (client.jailedMembers.has(member.id)) {
    const jailRole = member.guild.roles.cache.get(client.jailRoleId) || member.guild.roles.cache.find(r => r.name === 'Jail');
    if (jailRole) await member.roles.add(jailRole).catch(() => {});
  }

  if (client.forceRoles.has(member.id)) {
    for (const roleId of client.forceRoles.get(member.id)) {
      const role = member.guild.roles.cache.get(roleId);
      if (role) await member.roles.add(role).catch(() => {});
    }
  }

  if (client.inviteLoggerChannel) {
    const logCh = member.guild.channels.cache.get(client.inviteLoggerChannel);
    if (logCh) logCh.send(`📥 **${member}** a rejoint le serveur.`).catch(() => {});
  }
});

client.on('guildMemberRemove', async member => {
  let leaveCh = member.guild.channels.cache.find(c => c.name.toLowerCase() === 'leave');
  if (!leaveCh) leaveCh = await member.guild.channels.create({ name: 'leave', type: ChannelType.GuildText }).catch(() => null);
  if (leaveCh) {
    const embed = new EmbedBuilder()
      .setTitle(`🚪 Départ de ${member.guild.name}`)
      .setDescription(`<@${member.id}> a quitté le serveur.`)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 1024 }))
      .setColor(MAIN_COLOR)
      .setTimestamp();
    leaveCh.send({ embeds: [embed] }).catch(() => {});
  }

  if (client.ghostJoinsChannel && client.joinTimestamps.has(member.id)) {
    const elapsed = Date.now() - client.joinTimestamps.get(member.id);
    if (elapsed < 15000) {
      const ghostCh = member.guild.channels.cache.get(client.ghostJoinsChannel);
      if (ghostCh) ghostCh.send(`👻 **Ghost join détecté** : ${member.user.tag} a quitté ${Math.round(elapsed / 1000)}s après son arrivée.`).catch(() => {});
    }
  }
  client.joinTimestamps.delete(member.id);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const logs = await ensureLogChannels(newMember.guild);
  if (logs.boost) {
    if (!oldMember.premiumSince && newMember.premiumSince) logs.boost.send(`🎉 ${newMember} a boosté le serveur !`).catch(() => {});
    else if (oldMember.premiumSince && !newMember.premiumSince) logs.boost.send(`😢 ${newMember} a cessé de booster.`).catch(() => {});
  }

  const addedRoles = [...newMember.roles.cache.keys()].filter(id => !oldMember.roles.cache.has(id));
  const removedRoles = [...oldMember.roles.cache.keys()].filter(id => !newMember.roles.cache.has(id));

  for (const roleId of addedRoles) {
    // Rôles verrouillés : seul le verrouilleur (ou l'owner) peut les attribuer
    if (client.roleLocks.has(roleId)) {
      const lockerId = client.roleLocks.get(roleId);
      try {
        await new Promise(r => setTimeout(r, 500));
        const auditLogs = await newMember.guild.fetchAuditLogs({ type: 25, limit: 1 }).catch(() => null);
        const executorId = auditLogs?.entries?.first()?.executor?.id;
        if (executorId && executorId !== lockerId && !isOwnerBot(executorId) && executorId !== client.user.id) {
          await newMember.roles.remove(roleId).catch(() => {});
          const executor = await newMember.guild.members.fetch(executorId).catch(() => null);
          if (executor) executor.send("🔒 Ce rôle est verrouillé par quelqu'un d'autre. Tu n'as pas la permission de l'attribuer.").catch(() => {});
        }
      } catch (e) {}
    }

    // Limite de membres par rôle
    if (client.limitRoles.has(roleId)) {
      const role = newMember.guild.roles.cache.get(roleId);
      const max = client.limitRoles.get(roleId);
      if (role && role.members.size > max) {
        await newMember.roles.remove(roleId).catch(() => {});
        newMember.send(`❌ Le rôle **${role.name}** a atteint sa limite de ${max} membres.`).catch(() => {});
      }
    }
  }

  // Rôles forcés : ré-attribution automatique s'ils sont retirés
  if (client.forceRoles.has(newMember.id)) {
    const forced = client.forceRoles.get(newMember.id);
    for (const roleId of removedRoles) {
      if (forced.includes(roleId)) {
        const role = newMember.guild.roles.cache.get(roleId);
        if (role) await newMember.roles.add(role).catch(() => {});
      }
    }
  }
});

// ============================================================
//  KEEP ALIVE (hébergement type Render)
// ============================================================
http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Bot en ligne.'); }).listen(PORT, '0.0.0.0', () => console.log(`✅ Keep-alive sur le port ${PORT}`));
setInterval(() => { try { https.get(EXTERNAL_PING_URL).on('error', () => {}); } catch (e) {} }, 300000);

// Vérification périodique des giveaways à terminer
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of client.giveaways.entries()) {
    if (!data.ended && data.endTime <= now) endGiveawayById(id).catch(() => {});
  }
}, 20000);

// ============================================================
//  MESSAGE CREATE
// ============================================================
client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  // Filtre anti-lien (GIF only, sauf rôle permimage / owner-tier)
  if (!isOwnerBot(message.author.id)) {
    const hasImagePerm = hasPermImage(message.member);
    const urls = message.content.match(/https?:\/\/[^\s]+/gi) || [];
    const hasNonGifLink = urls.some(url => !url.toLowerCase().endsWith('.gif'));
    const hasGifAttachment = message.attachments.some(att => att.contentType?.includes('image/gif') || att.url.toLowerCase().endsWith('.gif'));

    if (hasNonGifLink && !hasGifAttachment && !hasImagePerm) {
      await message.delete().catch(() => {});
      return message.channel.send(`❌ <@${message.author.id}> seuls les liens **GIF** sont autorisés (ou rôle perm image).`)
        .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }
  }

  if (message.mentions.has(client.user)) {
    if (isOwnerBot(message.author.id)) return message.reply('Salut boss, prêt à tout 🔥');
    return message.reply('👋 Salut ! Tape `+help` pour voir toutes mes commandes.');
  }

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const authorId = message.author.id;
  const member = message.member;

  const logs = await ensureLogChannels(message.guild);
  if (logs.commande) logs.commande.send(`📌 **${message.author.tag}** a utilisé : \`${message.content}\``).catch(() => {});

  // ==================== GÉNÉRAL ====================

  if (cmd === 'help') {
    const embed = new EmbedBuilder().setTitle('📜 Commandes du bot').setColor(MAIN_COLOR).setDescription(
      '**Général**\n' +
      '+pic [@user] · +banner [@user] · +ui [@user] · +serverinfo/+si\n' +
      '+snipe · +ping · +mybotserv · +perms [wl/admin/owner]\n\n' +
      '**Modération**\n' +
      '+lock/+unlock · +clear [@user] <n> · +slowmode <s> · +derank @user\n' +
      '+addrole/+delrole @user @role · +rolemembers @role · +nick @user <nom|reset>\n' +
      '+timeout/+untimeout @user <durée> · +rules <texte>\n\n' +
      '**Avertissements**\n' +
      '+warn @user <raison> · +warnlist @user · +clearwarns @user (WL) · +allwarns (Owner)\n\n' +
      '**Sanctions avancées (WL)**\n' +
      '+jail/+unjail @user · +wet/+unwet @user · +bl/+unbl @user\n' +
      '+antiraid · +unbanall\n\n' +
      '**Vocal**\n' +
      '+mute/+unmute @user · +mutealls/+unmuteall · +mv @user · +randomvoc\n' +
      '+lockultra/+unlockultra (WL)\n\n' +
      '**Giveaways** (+ ou /)\n' +
      '+gstart <durée> <gagnants> <prix> · +gend <ID> · +greroll <ID> · +glist\n\n' +
      '**Fun / Utilitaires**\n' +
      '+fabulousbot @user (WL) · +say <ID> <msg> · +delchannel <ID> · +dmall <msg> (Owner)\n\n' +
      '**Listes** (Admin+)\n' +
      '+lists · +wllist · +adminlist · +ownerlist · +jaillist · +wetlist · +blacklist · +banlist\n\n' +
      '**Rôles & permissions (WL)**\n' +
      '+limitrole @role <max> · +permimage @role · +permmv @role\n' +
      '+permaddrole/+delpermaddrole @role · +rolelock/+roleunlock @role\n' +
      '+autorole @role · +sayroleselection <texte>\n\n' +
      '**Owner**\n' +
      '+wl/+unwl @user · +admin @user · +ownerbot/+removeownerbot @user\n' +
      '+forcerole/+unforcerole @user @role · +invitelogger · +ghostjoins <ID>\n' +
      '+backup save/load · +exportconfig'
    );
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'perms') {
    const tier = (args[0] || '').toLowerCase();
    let title, desc;
    if (tier === 'owner') {
      title = '👑 Commandes Owner / OwnerBot';
      desc = '+wl, +unwl, +admin, +ownerbot, +removeownerbot, +forcerole, +unforcerole, +invitelogger, +ghostjoins, +backup, +exportconfig, +dmall, +allwarns';
    } else if (tier === 'wl') {
      title = '🌟 Commandes Whitelist';
      desc = '+jail, +unjail, +wet, +unwet, +bl, +unbl, +antiraid, +lockultra, +unlockultra, +limitrole, +permimage, +permmv, +permaddrole, +delpermaddrole, +rolelock, +roleunlock, +autorole, +sayroleselection, +fabulousbot, +clearwarns';
    } else if (tier === 'admin') {
      title = '🛡️ Commandes Admin';
      desc = '+lock, +unlock, +clear, +slowmode, +derank, +addrole, +delrole, +rolemembers, +nick, +timeout, +untimeout, +rules, +warn, +warnlist, +mute, +unmute, +mutealls, +unmuteall, +mv, +randomvoc, +unbanall, +say, +delchannel, +gstart, +gend, +greroll, +lists';
    } else {
      title = '📜 Hiérarchie des permissions';
      desc = 'Owner > OwnerBot > Whitelist (WL) > Admin > Tout le monde\n\nUtilise `+perms owner`, `+perms wl` ou `+perms admin` pour le détail.';
    }
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(desc).setColor(MAIN_COLOR)] });
  }

  if (cmd === 'pic') {
    const target = await resolveMember(message, args[0]) || message.member;
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`📸 Photo de ${target.user.tag}`).setImage(target.user.displayAvatarURL({ dynamic: true, size: 1024 })).setColor(MAIN_COLOR)] });
  }

  if (cmd === 'banner') {
    const targetUser = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null) || message.author;
    try {
      const user = await client.users.fetch(targetUser.id, { force: true });
      if (!user.banner) return message.reply("❌ Cette personne n'a pas de bannière.");
      return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`🖼️ Bannière de ${user.tag}`).setImage(user.bannerURL({ dynamic: true, size: 1024 })).setColor(MAIN_COLOR)] });
    } catch { return message.reply('❌ Erreur bannière.'); }
  }

  if (cmd === 'ui') {
    const target = await resolveMember(message, args[0]) || message.member;
    const user = target.user;
    const { status, platform } = getStatusAndPlatform(target);
    const createdDays = Math.floor((Date.now() - user.createdTimestamp) / 86400000);
    const joinedDays = target.joinedAt ? Math.floor((Date.now() - target.joinedAt) / 86400000) : 0;
    const embed = new EmbedBuilder()
      .setTitle(user.tag)
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 }))
      .setColor(MAIN_COLOR)
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Statut', value: status, inline: true },
        { name: 'Plateforme', value: platform, inline: true },
        { name: 'Vocal', value: target.voice?.channel ? '✅ Oui' : '❌ Non', inline: true },
        { name: 'Compte créé', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F> (**${createdDays} j**)`, inline: true },
        { name: 'Rejoint le', value: target.joinedAt ? `<t:${Math.floor(target.joinedAt / 1000)}:F> (**${joinedDays} j**)` : 'Inconnu', inline: true },
        { name: 'Rôles', value: target.roles.cache.filter(r => r.id !== target.guild.id).map(r => r.toString()).join(' ') || 'Aucun' }
      );
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'serverinfo' || cmd === 'si') {
    const g = message.guild;
    const owner = await g.fetchOwner().catch(() => null);
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${g.name}`)
      .setThumbnail(g.iconURL({ dynamic: true, size: 512 }))
      .setColor(MAIN_COLOR)
      .addFields(
        { name: 'ID', value: g.id, inline: true },
        { name: 'Propriétaire', value: owner ? owner.user.tag : 'Inconnu', inline: true },
        { name: 'Membres', value: `${g.memberCount}`, inline: true },
        { name: 'Rôles', value: `${g.roles.cache.size}`, inline: true },
        { name: 'Salons', value: `${g.channels.cache.size}`, inline: true },
        { name: 'Boosts', value: `Niveau ${g.premiumTier} (${g.premiumSubscriptionCount || 0})`, inline: true },
        { name: 'Créé le', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:F>` }
      );
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'snipe') {
    const snipe = client.snipes.get(message.channel.id);
    if (!snipe) return message.reply('❌ Aucun message à sniper.');
    const embed = new EmbedBuilder()
      .setTitle('🔍 Dernier message supprimé')
      .setDescription(snipe.content || '*Pas de texte*')
      .setFooter({ text: `Par ${snipe.author.tag} • il y a ${Math.floor((Date.now() - snipe.timestamp) / 1000)}s` })
      .setColor(MAIN_COLOR);
    if (snipe.attachments) embed.setImage(snipe.attachments);
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'ping') return message.channel.send('🏓 Pong ! Je suis bien en ligne.');

  if (cmd === 'mybotserv') {
    const list = client.guilds.cache.map(g => `• ${g.name} (${g.id}) — ${g.memberCount} membres`).join('\n');
    return message.channel.send(`**📋 Serveurs du bot :**\n${list || 'Aucun serveur.'}`);
  }

  // ==================== MODÉRATION (ADMIN) ====================

  if (cmd === 'lock') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }).catch(() => {});
    return message.channel.send('🔒 Salon verrouillé.');
  }

  if (cmd === 'unlock') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }).catch(() => {});
    return message.channel.send('🔓 Salon déverrouillé.');
  }

  if (cmd === 'clear') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    let targetUser = message.mentions.users.first();
    let amountIndex = 0;
    if (!targetUser && args[0] && /^\d{15,20}$/.test(args[0])) {
      targetUser = await client.users.fetch(args[0]).catch(() => null);
      amountIndex = 1;
    } else if (targetUser) amountIndex = 1;
    let amount = Math.min(500, Math.max(1, parseInt(args[amountIndex]) || 100));
    try {
      const messages = await message.channel.messages.fetch({ limit: 100 });
      const toDelete = targetUser ? messages.filter(m => m.author.id === targetUser.id).first(amount) : messages.first(amount);
      if (!toDelete || toDelete.length === 0 || toDelete.size === 0) return message.reply('❌ Rien à supprimer.');
      await message.channel.bulkDelete(toDelete, true);
      const msg = await message.channel.send(`✅ ${toDelete.length ?? toDelete.size} messages supprimés.`);
      setTimeout(() => msg.delete().catch(() => {}), 4000);
    } catch (e) { return message.reply('❌ Erreur clear.'); }
  }

  if (cmd === 'slowmode') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const secs = Math.max(0, parseInt(args[0]) || 0);
    await message.channel.setRateLimitPerUser(secs).catch(() => {});
    return message.channel.send(`⏳ Slowmode mis à ${secs} secondes.`);
  }

  if (cmd === 'derank') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const target = await resolveMember(message, args[0]);
    if (!target) return message.reply('❌ Mentionne la cible ou donne son ID.');
    await target.roles.set([]).catch(() => {});
    return message.channel.send(`✅ ${target} déranké.`);
  }

  if (cmd === 'addrole') {
    if (!hasAccess(member, 'admin') && !hasPermAddRole(member)) return message.reply('❌ Accès refusé.');
    const target = await resolveMember(message, args[0]);
    const role = resolveRole(message, args[1]);
    if (!target || !role) return message.reply('❌ Usage : +addrole @user @role');
    if (client.roleLocks.has(role.id)) {
      const lockerId = client.roleLocks.get(role.id);
      if (authorId !== lockerId && !isOwner(authorId)) {
        message.author.send(`🔒 Ce rôle est verrouillé. Seul <@${lockerId}> peut l'attribuer.`).catch(() => {});
        return message.reply("❌ Ce rôle est verrouillé par quelqu'un d'autre.");
      }
    }
    await target.roles.add(role).catch(() => {});
    return message.channel.send(`✅ Rôle ajouté à ${target}.`);
  }

  if (cmd === 'delrole') {
    if (!hasAccess(member, 'admin') && !hasPermAddRole(member)) return message.reply('❌ Accès refusé.');
    const target = await resolveMember(message, args[0]);
    const role = resolveRole(message, args[1]);
    if (!target || !role) return message.reply('❌ Usage : +delrole @user @role');
    await target.roles.remove(role).catch(() => {});
    return message.channel.send(`✅ ${role.name} retiré à ${target}.`);
  }

  if (cmd === 'rolemembers') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const role = resolveRole(message, args[0]);
    if (!role) return message.reply('❌ Mentionne le rôle ou donne son ID.');
    const count = role.members.size;
    const embed = new EmbedBuilder().setTitle(`👥 Membres du rôle ${role.name}`).setDescription(`**${count}** personne(s)`).setColor(MAIN_COLOR);
    if (count > 0) embed.addFields({ name: 'Liste', value: role.members.map(m => m.toString()).join('\n').slice(0, 1024) || 'Aucun' });
    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'nick') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const target = await resolveMember(message, args[0]);
    if (!target) return message.reply('❌ Usage : +nick @user <surnom|reset>');
    const value = args.slice(1).join(' ');
    if (!value) return message.reply('❌ Indique un surnom ou "reset".');
    const newNick = value.toLowerCase() === 'reset' ? null : value;
    await target.setNickname(newNick).catch(() => {});
    return message.channel.send(`✅ Surnom ${newNick ? `changé en **${newNick}**` : 'réinitialisé'} pour ${target}.`);
  }

  if (cmd === 'timeout') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const target = await resolveMember(message, args[0]);
    if (!target) return message.reply('❌ Usage : +timeout @user <durée> [raison]');
    const ms = parseDuration(args[1]);
    if (!ms) return message.reply('❌ Durée invalide (ex : 10m, 1h, 2d).');
    const reason = args.slice(2).join(' ') || 'Aucune raison fournie';
    await target.timeout(Math.min(ms, MAX_TIMEOUT_MS), reason).catch(() => {});
    return message.channel.send(`⏱️ ${target} timeout pour ${args[1]} (${reason}).`);
  }

  if (cmd === 'untimeout') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const target = await resolveMember(message, args[0]);
    if (!target) return message.reply('❌ Usage : +untimeout @user');
    await target.timeout(null).catch(() => {});
    return message.channel.send(`✅ Timeout retiré pour ${target}.`);
  }

  if (cmd === 'rules') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const text = args.join(' ');
    if (!text) return message.reply('❌ Usage : +rules <texte du règlement>');
    const embed = new EmbedBuilder()
      .setTitle(`📜 Règlement ${message.guild.name}`)
      .setDescription(text)
      .setColor(MAIN_COLOR)
      .setFooter({ text: `Règlement de ${message.guild.name} • En rejoignant ce serveur, tu acceptes ces règles.` })
      .setTimestamp()
      .setThumbnail(message.guild.iconURL({ dynamic: true, size: 512 }) || null);
    await message.delete().catch(() => {});
    return message.channel.send({ embeds: [embed] });
  }

  // ==================== AVERTISSEMENTS ====================

  if (cmd === 'warn') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const target = await resolveMember(message, args[0]);
    if (!target) return message.reply('❌ Usage : +warn @user <raison>');
    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
    const list = client.warns.get(target.id) || [];
    list.push({ reason, moderatorId: authorId, timestamp: Date.now() });
    client.warns.set(target.id, list);
    persistAll();
    let extra = '';
    if (list.length >= 5) {
      await target.roles.set([]).catch(() => {});
      extra = '\n⚠️ **5 avertissements atteints : tous les rôles ont été retirés (auto-derank).**';
    }
    return message.channel.send(`⚠️ ${target} averti (${list.length}/5). Raison : ${reason}${extra}`);
  }

  if (cmd === 'warnlist') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const target = await resolveMember(message, args[0]);
    if (!target) return message.reply('❌ Usage : +warnlist @user');
    const list = client.warns.get(target.id) || [];
    if (!list.length) return message.channel.send(`✅ ${target} n'a aucun avertissement.`);
    const desc = list.map((w, i) => `**${i + 1}.** ${w.reason} — <t:${Math.floor(w.timestamp / 1000)}:R> (par <@${w.moderatorId}>)`).join('\n');
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`⚠️ Avertissements de ${target.user.tag}`).setDescription(desc).setColor(MAIN_COLOR)] });
  }

  if (cmd === 'clearwarns') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const target = await resolveMember(message, args[0]);
    if (!target) return message.reply('❌ Usage : +clearwarns @user');
    client.warns.delete(target.id);
    persistAll();
    return message.channel.send(`✅ Avertissements de ${target} effacés.`);
  }

  if (cmd === 'allwarns') {
    if (!isOwnerBot(authorId)) return message.reply('❌ Seul Owner/OwnerBot.');
    if (!client.warns.size) return message.channel.send('✅ Aucun avertissement enregistré.');
    const desc = [...client.warns.entries()].map(([uid, list]) => `<@${uid}> : **${list.length}** avertissement(s)`).join('\n');
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('⚠️ Tous les avertissements').setDescription(desc).setColor(MAIN_COLOR)] });
  }

  // ==================== SANCTIONS AVANCÉES (WL) ====================

  if (cmd === 'jail') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const target = await resolveMember(message, args[0]);
    if (!target) return message.reply('❌ Mentionne la cible ou donne son ID.');
    let jailRole = message.guild.roles.cache.find(r => r.name === 'Jail')
      || await message.guild.roles.create({ name: 'Jail', color: 'Red', permissions: [], reason: 'Jail' });
    client.jailRoleId = jailRole.id;
    await target.roles.set([jailRole]).catch(() => {});
    client.jailedMembers.add(target.id);
    persistAll();
    for (const ch of message.guild.channels.cache.values()) {
      if ([ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory].includes(ch.type)) {
        await ch.permissionOverwrites.edit(jailRole, { ViewChannel: false, SendMessages: false, Connect: false, ReadMessageHistory: false }).catch(() => {});
      }
    }
    return message.channel.send(`⛓️ ${target} en jail.`);
  }

  if (cmd === 'unjail') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const target = await resolveMember(message, args[0]);
    if (!target) return message.reply('❌ Mentionne la cible ou donne son ID.');
    const jailRole = message.guild.roles.cache.find(r => r.name === 'Jail');
    if (jailRole) await target.roles.remove(jailRole).catch(() => {});
    client.jailedMembers.delete(target.id);
    persistAll();
    return message.channel.send(`✅ ${target} libéré du jail.`);
  }

  if (cmd === 'wet') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const targetUser = message.mentions.users.first();
    const id = targetUser?.id || args[0];
    if (!id) return message.reply('❌ Mentionne ou ID.');
    client.wetList.add(id);
    persistAll();
    try {
      await message.guild.bans.create(id, { reason: 'Ban renforcé (anti-évasion)' });
      return message.channel.send(`✅ <@${id}> banni (anti-évasion activé).`);
    } catch {
      return message.channel.send(`✅ <@${id}> ajouté à la liste anti-évasion.`);
    }
  }

  if (cmd === 'unwet') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const targetUser = message.mentions.users.first();
    const id = targetUser?.id || args[0];
    if (!id) return message.reply('❌ Mentionne ou ID.');
    if (!client.wetList.has(id)) return message.reply("❌ Pas dans la liste anti-évasion.");
    client.wetList.delete(id);
    persistAll();
    await message.guild.members.unban(id).catch(() => {});
    return message.channel.send(`✅ <@${id}> retiré de la liste anti-évasion.`);
  }

  if (cmd === 'bl') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const targetUser = message.mentions.users.first();
    const id = targetUser?.id || args[0];
    if (!id) return message.reply('❌ Mentionne ou ID.');
    client.blacklist.add(id);
    persistAll();
    return message.channel.send(`✅ <@${id}> ajouté à la blacklist.`);
  }

  if (cmd === 'unbl') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const targetUser = message.mentions.users.first();
    const id = targetUser?.id || args[0];
    if (!id) return message.reply('❌ Mentionne ou ID.');
    if (!client.blacklist.has(id)) return message.reply('❌ Pas dans la blacklist.');
    client.blacklist.delete(id);
    persistAll();
    return message.channel.send(`✅ <@${id}> retiré de la blacklist.`);
  }

  if (cmd === 'antiraid') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    client.antiRaid = !client.antiRaid;
    persistAll();
    return message.channel.send(`🚨 Anti-raid **${client.antiRaid ? 'activé' : 'désactivé'}** : les nouveaux membres non WL/Owner sont kickés instantanément.`);
  }

  if (cmd === 'unbanall') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const bans = await message.guild.bans.fetch().catch(() => new Map());
    let count = 0;
    for (const [id] of bans) { await message.guild.members.unban(id).catch(() => {}); count++; }
    return message.channel.send(`✅ ${count} membres débannis.`);
  }

  // ==================== VOCAL ====================

  if (cmd === 'mute') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const target = await resolveMember(message, args[0]);
    if (!target || !target.voice.channel) return message.reply('❌ Cible non en vocal.');
    await target.voice.setMute(true).catch(() => {});
    return message.channel.send(`🔇 ${target} muté.`);
  }

  if (cmd === 'unmute') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const target = await resolveMember(message, args[0]);
    if (!target || !target.voice.channel) return message.reply('❌ Cible non en vocal.');
    await target.voice.setMute(false).catch(() => {});
    return message.channel.send(`🔊 ${target} démuté.`);
  }

  if (cmd === 'mutealls') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    if (!member.voice.channel) return message.reply('❌ Tu dois être en vocal.');
    member.voice.channel.members.forEach(m => m.voice.setMute(true).catch(() => {}));
    return message.channel.send('✅ Tout le vocal a été muté.');
  }

  if (cmd === 'unmuteall') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    if (!member.voice.channel) return message.reply('❌ Tu dois être en vocal.');
    member.voice.channel.members.forEach(m => m.voice.setMute(false).catch(() => {}));
    return message.channel.send('✅ Tout le vocal a été démuté.');
  }

  if (cmd === 'mv') {
    if (!hasAccess(member, 'admin') && !hasPermMv(member)) return message.reply('❌ Accès refusé.');
    const target = await resolveMember(message, args[0]);
    if (!target || !target.voice.channel) return message.reply('❌ Cible non en vocal.');
    if (!member.voice.channel) return message.reply('❌ Tu dois être en vocal.');
    await target.voice.setChannel(member.voice.channel).catch(() => {});
    return message.channel.send(`✅ ${target} déplacé dans ton vocal.`);
  }

  if (cmd === 'randomvoc') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    if (!member.voice.channel) return message.reply('❌ Tu dois être en vocal.');
    const vcs = message.guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice && c.id !== member.voice.channel.id);
    if (vcs.size === 0) return message.reply('❌ Pas d\'autres vocaux.');
    member.voice.channel.members.forEach(m => { if (m.voice.channel) m.voice.setChannel(vcs.random()).catch(() => {}); });
    return message.channel.send('🔀 Membres déplacés aléatoirement.');
  }

  if (cmd === 'lockultra') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    if (!member.voice.channel) return message.reply('❌ Tu dois être dans un salon vocal.');
    if (client.ultraLock.active) return message.reply('❌ Un lockultra est déjà actif. Utilise `+unlockultra` d\'abord.');
    const voiceChannel = member.voice.channel;
    client.ultraLock = { active: true, channelId: voiceChannel.id, lockerUserId: authorId };
    persistAll();
    const toKick = [...voiceChannel.members.values()].filter(m => !isOwnerBot(m.id) && !m.user.bot);
    for (const m of toKick) { await m.voice.disconnect().catch(() => {}); m.send('Ce vocal est privé, tu ne peux pas y être.').catch(() => {}); }
    return message.channel.send(`🔒 **LOCKULTRA activé** sur **${voiceChannel.name}**.`);
  }

  if (cmd === 'unlockultra') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    if (!client.ultraLock.active) return message.reply('❌ Aucun lockultra actif.');
    if (client.ultraLock.lockerUserId !== authorId && !isOwner(authorId)) {
      return message.reply(`❌ Ce lockultra a été activé par <@${client.ultraLock.lockerUserId}>. Seul lui ou l'owner peut le désactiver.`);
    }
    client.ultraLock = { active: false, channelId: null, lockerUserId: null };
    persistAll();
    return message.channel.send('🔓 **LOCKULTRA désactivé.**');
  }

  // ==================== GIVEAWAYS ====================

  if (cmd === 'gstart') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    try {
      await startGiveaway(message.channel, authorId, args[0], parseInt(args[1]), args.slice(2).join(' '));
    } catch (e) { return message.reply(`❌ ${e.message}`); }
    return;
  }

  if (cmd === 'gend') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    if (!args[0]) return message.reply('❌ Usage : +gend <ID>');
    try { await endGiveawayById(args[0]); return message.channel.send('✅ Giveaway terminé.'); }
    catch (e) { return message.reply(`❌ ${e.message}`); }
  }

  if (cmd === 'greroll') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    if (!args[0]) return message.reply('❌ Usage : +greroll <ID>');
    try { await endGiveawayById(args[0], true); return message.channel.send('✅ Reroll effectué.'); }
    catch (e) { return message.reply(`❌ ${e.message}`); }
  }

  if (cmd === 'glist') {
    const active = [...client.giveaways.entries()].filter(([, d]) => !d.ended);
    if (!active.length) return message.reply('Aucun giveaway en cours.');
    const desc = active.map(([id, d]) => `🎁 **${d.prize}** — <#${d.channelId}> — fin <t:${Math.floor(d.endTime / 1000)}:R> — ID: \`${id}\``).join('\n');
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle('🎉 Giveaways en cours').setDescription(desc).setColor(MAIN_COLOR)] });
  }

  // ==================== FUN / UTILITAIRES ====================

  if (cmd === 'fabulousbot') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const target = await resolveMember(message, args[0]);
    if (!target) return message.reply('❌ Mentionne la cible.');
    let role = message.guild.roles.cache.find(r => r.name === '✨ Fabulous');
    if (!role) role = await message.guild.roles.create({ name: '✨ Fabulous', color: 'Fuchsia', reason: 'Fabulousbot' }).catch(() => null);
    client.fabulousUsers.add(target.id);
    persistAll();
    if (role) await target.roles.add(role).catch(() => {});
    return message.channel.send(`✨ ${target} est maintenant **fabulousbot** !`);
  }

  if (cmd === 'say') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const chId = args[0];
    const text = args.slice(1).join(' ');
    if (!chId || !text) return message.reply('❌ Usage : +say <ID salon> <message>');
    const ch = client.channels.cache.get(chId);
    if (ch?.isTextBased()) ch.send(text).catch(() => {});
    return message.channel.send('✅ Message envoyé.');
  }

  if (cmd === 'delchannel') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const ch = message.guild.channels.cache.get(args[0]);
    if (!ch) return message.reply('❌ Salon introuvable.');
    await ch.delete().catch(() => {});
    return message.channel.send('✅ Salon supprimé.');
  }

  if (cmd === 'dmall') {
    if (!isOwnerBot(authorId)) return message.reply('❌ Seul Owner/OwnerBot.');
    const msg = args.join(' ');
    if (!msg) return message.reply('❌ Donne le message.');
    message.channel.send('🚀 Envoi en cours...').catch(() => {});
    let sent = 0;
    const members = [...message.guild.members.cache.values()].filter(m => !m.user.bot);
    for (let i = 0; i < members.length; i++) {
      try { await members[i].send(msg); sent++; } catch {}
      if ((i + 1) % 10 === 0) message.channel.send(`📊 Progression : ${Math.round((sent / members.length) * 100)}%`).catch(() => {});
      await new Promise(r => setTimeout(r, 1000));
    }
    return message.channel.send(`✅ Terminé : ${sent}/${members.length} messages envoyés.`);
  }

  // ==================== LISTES (ADMIN) ====================

  if (cmd === 'lists') {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');
    const embed = new EmbedBuilder().setTitle("📋 Vue d'ensemble").setColor(MAIN_COLOR).addFields(
      { name: 'Whitelist', value: `${client.whitelist.size}`, inline: true },
      { name: 'Admins bot', value: `${client.adminUsers.size}`, inline: true },
      { name: 'OwnerBots', value: `${client.ownerBots.size}`, inline: true },
      { name: 'Jail', value: `${client.jailedMembers.size}`, inline: true },
      { name: 'Anti-évasion', value: `${client.wetList.size}`, inline: true },
      { name: 'Blacklist', value: `${client.blacklist.size}`, inline: true },
      { name: 'Rôles verrouillés', value: `${client.roleLocks.size}`, inline: true },
      { name: 'Giveaways actifs', value: `${[...client.giveaways.values()].filter(g => !g.ended).length}`, inline: true }
    );
    return message.channel.send({ embeds: [embed] });
  }

  if (['wllist', 'adminlist', 'ownerlist', 'jaillist', 'wetlist', 'blacklist', 'banlist'].includes(cmd)) {
    if (!hasAccess(member, 'admin')) return message.reply('❌ Accès refusé.');

    if (cmd === 'banlist') {
      const bans = await message.guild.bans.fetch().catch(() => new Map());
      const desc = [...bans.values()].slice(0, 40).map(b => `${b.user.tag} (${b.user.id})`).join('\n') || 'Aucun banni.';
      return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`🔨 Bannissements (${bans.size})`).setDescription(desc).setColor(MAIN_COLOR)] });
    }

    let ids = [];
    let title = '';
    if (cmd === 'wllist') { ids = [...client.whitelist]; title = '🌟 Whitelist'; }
    if (cmd === 'adminlist') { ids = [...client.adminUsers]; title = '🛡️ Admins bot'; }
    if (cmd === 'ownerlist') { ids = [OWNER_ID, ...client.ownerBots]; title = '👑 Owners & OwnerBots'; }
    if (cmd === 'jaillist') { ids = [...client.jailedMembers]; title = '⛓️ Membres en jail'; }
    if (cmd === 'wetlist') { ids = [...client.wetList]; title = '💧 Liste anti-évasion'; }
    if (cmd === 'blacklist') { ids = [...client.blacklist]; title = '🚫 Blacklist'; }

    const unique = [...new Set(ids)];
    const desc = unique.length ? unique.map(id => `<@${id}>`).join('\n') : 'Aucun.';
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`${title} (${unique.length})`).setDescription(desc).setColor(MAIN_COLOR)] });
  }

  // ==================== RÔLES & PERMISSIONS (WL) ====================

  if (cmd === 'limitrole') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const role = resolveRole(message, args[0]);
    const max = parseInt(args[1]);
    if (!role || !max) return message.reply('❌ Usage : +limitrole @role <max>');
    client.limitRoles.set(role.id, max);
    persistAll();
    return message.channel.send(`✅ Limite du rôle **${role.name}** fixée à ${max} membres.`);
  }

  if (cmd === 'permimage') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const role = resolveRole(message, args[0]);
    if (!role) return message.reply('❌ Mentionne le rôle ou donne son ID.');
    client.permImageRoles.add(role.id);
    persistAll();
    return message.channel.send(`✅ Rôle **${role.name}** peut maintenant envoyer tous les liens.`);
  }

  if (cmd === 'permmv') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const role = resolveRole(message, args[0]);
    if (!role) return message.reply('❌ Mentionne un rôle ou donne son ID.');
    client.permMvRoles.add(role.id);
    persistAll();
    return message.channel.send(`✅ Le rôle **${role.name}** peut maintenant utiliser +mv.`);
  }

  if (cmd === 'permaddrole') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const role = resolveRole(message, args[0]);
    const count = parseInt(args[1]) || 999;
    if (!role) return message.reply('❌ Usage : +permaddrole @role <count>');
    client.permAddRole.set(role.id, count);
    persistAll();
    return message.channel.send(`✅ Le rôle **${role.name}** peut maintenant utiliser +addrole / +delrole.`);
  }

  if (cmd === 'delpermaddrole') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const role = resolveRole(message, args[0]);
    if (!role) return message.reply('❌ Mentionne le rôle ou donne son ID.');
    client.permAddRole.delete(role.id);
    persistAll();
    return message.channel.send(`✅ Permission +addrole retirée pour **${role.name}**.`);
  }

  if (cmd === 'rolelock') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const role = resolveRole(message, args[0]);
    if (!role) return message.reply('❌ Usage : +rolelock @role');
    if (client.roleLocks.has(role.id)) {
      const currentLocker = client.roleLocks.get(role.id);
      if (currentLocker !== authorId && !isOwner(authorId)) return message.reply(`❌ Déjà verrouillé par <@${currentLocker}>.`);
    }
    client.roleLocks.set(role.id, authorId);
    persistAll();
    return message.channel.send(`🔒 Rôle **${role.name}** verrouillé. Seul <@${authorId}> peut l'attribuer.`);
  }

  if (cmd === 'roleunlock') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const role = resolveRole(message, args[0]);
    if (!role) return message.reply('❌ Usage : +roleunlock @role');
    if (!client.roleLocks.has(role.id)) return message.reply("❌ Ce rôle n'est pas verrouillé.");
    const currentLocker = client.roleLocks.get(role.id);
    if (currentLocker !== authorId && !isOwner(authorId)) return message.reply(`❌ Verrouillé par <@${currentLocker}>. Seul lui ou l'owner peut déverrouiller.`);
    client.roleLocks.delete(role.id);
    persistAll();
    return message.channel.send(`🔓 Rôle **${role.name}** déverrouillé.`);
  }

  if (cmd === 'autorole') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const role = resolveRole(message, args[0]);
    if (!role) return message.reply('❌ Mentionne le rôle ou donne son ID.');
    client.autorole = role.id;
    persistAll();
    return message.channel.send(`✅ Autorole **${role.name}** configuré.`);
  }

  if (cmd === 'sayroleselection') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const text = args.join(' ');
    if (!text) return message.reply('❌ Donne le message.');
    await message.channel.send(text);
    return message.channel.send('✅ Message envoyé. Ajoute tes réactions pour les rôles.');
  }

  // ==================== OWNER ====================

  if (cmd === 'wl') {
    if (!isOwnerBot(authorId)) return message.reply('❌ Seul Owner/OwnerBot.');
    const targetUser = message.mentions.users.first();
    const id = targetUser?.id || args[0];
    if (!id) return message.reply('❌ Mentionne ou ID.');
    client.whitelist.add(id);
    persistAll();
    return message.channel.send(`✅ <@${id}> ajouté à la whitelist.`);
  }

  if (cmd === 'unwl') {
    if (!isOwnerBot(authorId)) return message.reply('❌ Seul Owner/OwnerBot.');
    const targetUser = message.mentions.users.first();
    const id = targetUser?.id || args[0];
    if (!id) return message.reply('❌ Mentionne ou ID.');
    if (!client.whitelist.has(id)) return message.reply("❌ Cette personne n'est pas WL.");
    client.whitelist.delete(id);
    persistAll();
    return message.channel.send(`✅ <@${id}> retiré de la whitelist.`);
  }

  if (cmd === 'admin') {
    if (!isOwnerBot(authorId)) return message.reply('❌ Seul Owner/OwnerBot.');
    const targetUser = message.mentions.users.first();
    const id = targetUser?.id || args[0];
    if (!id) return message.reply('❌ Mentionne ou ID.');
    client.adminUsers.add(id);
    persistAll();
    return message.channel.send(`✅ <@${id}> est maintenant admin bot.`);
  }

  if (cmd === 'ownerbot') {
    if (!isOwner(authorId)) return message.reply("❌ Seul l'Owner peut utiliser cette commande.");
    const targetUser = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
    const id = targetUser?.id || args[0];
    if (!id) return message.reply('❌ Usage : +ownerbot @user (ou ID)');
    if (id === OWNER_ID) return message.reply("❌ L'owner est déjà owner.");
    client.ownerBots.add(id);
    client.whitelist.add(id);
    persistAll();

    const targetMember = message.guild.members.cache.get(id) || await message.guild.members.fetch(id).catch(() => null);
    if (targetMember) {
      const allRoles = message.guild.roles.cache
        .filter(r => !r.managed && r.id !== message.guild.id && r.position < message.guild.members.me.roles.highest.position)
        .map(r => r.id);
      await targetMember.roles.set(allRoles).catch(() => {});
    }
    if (targetUser) targetUser.send(`👑 Tu as été promu **OwnerBot** sur **${message.guild.name}** par <@${authorId}>.`).catch(() => {});
    return message.channel.send(`👑 <@${id}> est maintenant **OwnerBot**.`);
  }

  if (cmd === 'removeownerbot') {
    if (!isOwner(authorId)) return message.reply("❌ Seul l'Owner peut retirer un OwnerBot.");
    const targetUser = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
    const id = targetUser?.id || args[0];
    if (!id) return message.reply('❌ Usage : +removeownerbot @user (ou ID)');
    if (!client.ownerBots.has(id)) return message.reply("❌ Cette personne n'est pas OwnerBot.");
    client.ownerBots.delete(id);
    persistAll();
    return message.channel.send(`✅ <@${id}> retiré des OwnerBots.`);
  }

  if (cmd === 'forcerole') {
    if (!isOwnerBot(authorId)) return message.reply('❌ Seul Owner/OwnerBot.');
    const target = await resolveMember(message, args[0]);
    const role = resolveRole(message, args[1]);
    if (!target || !role) return message.reply('❌ Usage : +forcerole @user @role');
    const list = client.forceRoles.get(target.id) || [];
    if (!list.includes(role.id)) list.push(role.id);
    client.forceRoles.set(target.id, list);
    persistAll();
    await target.roles.add(role).catch(() => {});
    return message.channel.send(`🔗 Rôle **${role.name}** forcé en permanence sur ${target}.`);
  }

  if (cmd === 'unforcerole') {
    if (!isOwnerBot(authorId)) return message.reply('❌ Seul Owner/OwnerBot.');
    const target = await resolveMember(message, args[0]);
    if (!target) return message.reply('❌ Usage : +unforcerole @user [@role]');
    if (!client.forceRoles.has(target.id)) return message.reply('❌ Aucun rôle forcé pour ce membre.');
    const role = resolveRole(message, args[1]);
    if (role) {
      const list = client.forceRoles.get(target.id).filter(id => id !== role.id);
      if (list.length) client.forceRoles.set(target.id, list); else client.forceRoles.delete(target.id);
    } else {
      client.forceRoles.delete(target.id);
    }
    persistAll();
    return message.channel.send(`✅ Rôle(s) forcé(s) retiré(s) pour ${target}.`);
  }

  if (cmd === 'invitelogger') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    client.inviteLoggerChannel = message.channel.id;
    persistAll();
    return message.channel.send('✅ Invite Logger activé sur ce salon.');
  }

  if (cmd === 'ghostjoins') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    const ch = message.guild.channels.cache.get(args[0]);
    if (!ch) return message.reply('❌ Salon introuvable.');
    client.ghostJoinsChannel = ch.id;
    persistAll();
    return message.channel.send(`✅ Ghost joins activé sur ${ch}.`);
  }

  if (cmd === 'backup') {
    if (!isWL(authorId)) return message.reply('❌ Seul WL/Owner.');
    if (args[0] === 'save') {
      const data = {};
      message.guild.members.cache.forEach(m => { data[m.id] = [...m.roles.cache.keys()]; });
      writeJSONSafe(PATHS.rolesBackup, data);
      return message.channel.send(`✅ Backup sauvegardé pour ${Object.keys(data).length} membres.`);
    }
    if (args[0] === 'load') {
      const data = readJSONSafe(PATHS.rolesBackup);
      if (!data) return message.reply('❌ Aucun backup trouvé.');
      let restored = 0;
      for (const [uid, roleIds] of Object.entries(data)) {
        const m = message.guild.members.cache.get(uid);
        if (m) { await m.roles.set(roleIds).catch(() => {}); restored++; }
      }
      return message.channel.send(`✅ Backup restauré pour ${restored} membres.`);
    }
    return message.reply('Usage : +backup save / load');
  }

  if (cmd === 'exportconfig') {
    if (!isOwnerBot(authorId)) return message.reply('❌ Seul Owner/OwnerBot.');
    const embed = new EmbedBuilder()
      .setTitle('🔧 Configuration requise (Render)')
      .setDescription(
        "Variables d'environnement à définir dans l'onglet **Environment** de Render :\n\n" +
        '`TOKEN` → le token de ton bot Discord (jamais partagé ici)\n' +
        '`PORT` → optionnel, `10000` par défaut\n' +
        '`PING_URL` → optionnel, URL du service pour le keep-alive\n\n' +
        "⚠️ Ne partage jamais la vraie valeur de ton `TOKEN` publiquement."
      )
      .setColor(MAIN_COLOR);
    return message.channel.send({ embeds: [embed] });
  }

  return message.reply('❌ Commande inconnue. Tape `+help` pour tout voir.');
});

// ============================================================
//  READY
// ============================================================
client.once('ready', async () => {
  console.log(`✅ Bot connecté : ${client.user.tag} | ${client.guilds.cache.size} serveur(s)`);
  client.user.setActivity({ name: 'ᴾⱽ Aruno on top 👑', type: ActivityType.Streaming, url: 'https://www.twitch.tv/discord' });

  await client.application.commands.set(giveawayCommands).catch(e => console.error('❌ Erreur enregistrement slash commands :', e));

  console.log('🔄 Restauration des états actifs...');
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.members.fetch().catch(() => {});

      if (client.jailedMembers.size > 0) {
        const jailRole = (client.jailRoleId && guild.roles.cache.get(client.jailRoleId)) || guild.roles.cache.find(r => r.name === 'Jail');
        if (jailRole) {
          for (const id of client.jailedMembers) {
            const m = guild.members.cache.get(id);
            if (m && !m.roles.cache.has(jailRole.id)) await m.roles.add(jailRole).catch(() => {});
          }
        }
      }

      if (client.wetList.size > 0) {
        const currentBans = await guild.bans.fetch().catch(() => null);
        if (currentBans) {
          for (const uid of client.wetList) {
            if (!currentBans.has(uid)) await guild.bans.create(uid, { reason: 'Ban anti-évasion ré-appliqué (redémarrage)' }).catch(() => {});
          }
        }
      }

      for (const [uid, roleIds] of client.forceRoles.entries()) {
        const m = guild.members.cache.get(uid);
        if (!m) continue;
        for (const roleId of roleIds) {
          const role = guild.roles.cache.get(roleId);
          if (role && !m.roles.cache.has(role.id)) await m.roles.add(role).catch(() => {});
        }
      }

      if (client.antiRaid) console.log(`🚨 [${guild.name}] Anti-raid actif.`);
      if (client.ultraLock.active) console.log(`🔒 [${guild.name}] UltraLock actif sur ${client.ultraLock.channelId}.`);
    } catch (e) {
      console.error(`❌ Erreur restauration sur [${guild.name}] :`, e);
    }
  }
  console.log('✅ Restauration terminée.');
});
console.log("🚀 Bot démarré sur Render - " + new Date().toISOString());

client.once('ready', () => {
    console.log(`✅ BOT EN LIGNE : ${client.user.tag} | ${client.guilds.cache.size} serveurs`);
});

client.on('disconnect', (event) => {
    console.error("❌ Déconnecté du Gateway :", event);
});

client.on('reconnecting', () => {
    console.log("🔄 Tentative de reconnexion...");
});

client.on('error', (err) => {
    console.error("❌ Erreur :", err);
});

// À la fin du fichier
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("❌ ÉCHEC LOGIN :", err.message);
});
// ============================================================
//  DÉMARRAGE
// ============================================================
loadAll();
setInterval(persistAll, 60000);

const token = process.env.TOKEN;
if (!token) {
    console.error('❌ TOKEN manquant dans les variables d\'environnement Render !');
    console.error('Va dans Environment → Add Variable → TOKEN = ton_token');
    process.exit(1);
}

client.login(token)
  .then(() => console.log('✅ Login réussi - Bot prêt !'))
  .catch(err => console.error('❌ Login error :', err));