// index.js — Mega-bot monolithique (tout en un)
// Requirements: Node 18+, discord.js v14, dotenv
// npm i discord.js@14 dotenv

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN || 'TON_TOKEN_ICI'; // Remplace ou mets dans .env
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------------- CONFIG ---------------- */
const CONFIG = {
  PREFIX: '+',
  OWNER_IDS: ['726063885492158474'], // Ton/tes ID(s) propriétaires (string)
  WL_ROLE_NAME: 'WL',                 // Nom du rôle whitelist
  ADMIN_ROLE_NAME: 'Admin',           // Nom rôle admin si tu veux l'utiliser
  MAIN_COLOR: 0x8A2BE2,
  SMASH_THREAD_ARCHIVE_MINUTES: 1440, // thread auto archive minutes
  ANTIRAID: {
    enabled: true,
    joinWindowMs: 10_000,
    joinThreshold: 4, // number of joins in window to consider raid
    minAccountAgeMs: 1000 * 60 * 60 * 24 * 3 // 3 days -> accounts younger are suspicious
  },
  BACKUP_DIR: path.join(DATA_DIR, 'backups')
};

if (!fs.existsSync(CONFIG.BACKUP_DIR)) fs.mkdirSync(CONFIG.BACKUP_DIR, { recursive: true });

/* ---------------- PATHS ---------------- */
const PATHS = {
  whitelist: path.join(DATA_DIR, 'whitelist.json'),
  adminUsers: path.join(DATA_DIR, 'adminUsers.json'),
  blacklist: path.join(DATA_DIR, 'blacklist.json'),
  wetlist: path.join(DATA_DIR, 'wetlist.json'),
  doglocks: path.join(DATA_DIR, 'doglocks.json'),
  permmv: path.join(DATA_DIR, 'permmv.json'),
  permaddrole: path.join(DATA_DIR, 'permaddrole.json'),
  fabulous: path.join(DATA_DIR, 'fabulous.json'),
  smashChannels: path.join(DATA_DIR, 'smashChannels.json'),
  invitesCache: path.join(DATA_DIR, 'invitesCache.json'),
  backupsDir: CONFIG.BACKUP_DIR
};

/* ---------------- CLIENT ---------------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

/* ---------------- IN-MEMORY STATE ---------------- */
client.state = {
  whitelist: new Set(),
  adminUsers: new Set(),
  blacklist: new Map(), // guildId -> Map(userId -> { reason, by, date })
  wetlist: new Map(),   // guildId -> Map(userId -> { by, reason, date })
  doglocks: new Map(),  // guildId -> Map(userId -> { oldNick, by, date })
  permmv: new Map(),    // guildId -> Set(roleId)
  permaddrole: new Map(),// guildId -> Map(roleId -> count)
  fabulous: new Map(),  // guildId -> Set(userId) (protected owners)
  smashChannels: new Map(), // guildId -> Set(channelId)
  invites: new Map(),   // guildId -> Map(inviteCode -> uses)
  inviteOwnerCount: new Map(), // guildId -> Map(userId -> count)
  ghostjoins: new Map(), // guildId -> channelId for ghostjoins
  recentJoins: new Map(), // guildId -> [timestamps]
  snipes: new Map() // channelId -> { content, authorTag, attachments, createdAt }
};

/* ---------------- HELPERS: JSON read/write atomic ---------------- */
function readJSONSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error('readJSONSafe error', filePath, e);
    return null;
  }
}
function writeAtomic(filePath, obj) {
  try {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, filePath);
    return true;
  } catch (e) {
    console.error('writeAtomic error', filePath, e);
    return false;
  }
}

/* ---------------- LOAD / PERSIST ---------------- */
function persistAll() {
  try {
    writeAtomic(PATHS.whitelist, [...client.state.whitelist]);
    writeAtomic(PATHS.adminUsers, [...client.state.adminUsers]);
    // blacklist per guild -> object
    const blObj = {};
    client.state.blacklist.forEach((map, guildId) => {
      blObj[guildId] = Array.from(map.entries());
    });
    writeAtomic(PATHS.blacklist, blObj);

    const wetObj = {};
    client.state.wetlist.forEach((map, guildId) => wetObj[guildId] = Array.from(map.entries()));
    writeAtomic(PATHS.wetlist, wetObj);

    const dogObj = {};
    client.state.doglocks.forEach((map, guildId) => dogObj[guildId] = Array.from(map.entries()));
    writeAtomic(PATHS.doglocks, dogObj);

    const pmvObj = {};
    client.state.permmv.forEach((set, guildId) => pmvObj[guildId] = [...set]);
    writeAtomic(PATHS.permmv, pmvObj);

    const parObj = {};
    client.state.permaddrole.forEach((map, guildId) => parObj[guildId] = Array.from(map.entries()));
    writeAtomic(PATHS.permaddrole, parObj);

    const fabObj = {};
    client.state.fabulous.forEach((set, guildId) => fabObj[guildId] = [...set]);
    writeAtomic(PATHS.fabulous, fabObj);

    const smashObj = {};
    client.state.smashChannels.forEach((set, guildId) => smashObj[guildId] = [...set]);
    writeAtomic(PATHS.smashChannels, smashObj);

    // invites cache
    const invObj = {};
    client.state.invites.forEach((m, guildId) => invObj[guildId] = Array.from(m.entries()));
    writeAtomic(PATHS.invitesCache, invObj);
  } catch (e) {
    console.error('persistAll error', e);
  }
}

function loadAll() {
  try {
    const wl = readJSONSafe(PATHS.whitelist);
    if (Array.isArray(wl)) wl.forEach(id => client.state.whitelist.add(String(id)));

    const adm = readJSONSafe(PATHS.adminUsers);
    if (Array.isArray(adm)) adm.forEach(id => client.state.adminUsers.add(String(id)));

    const bl = readJSONSafe(PATHS.blacklist);
    if (bl && typeof bl === 'object') {
      Object.entries(bl).forEach(([guildId, arr]) => {
        const map = new Map(arr);
        client.state.blacklist.set(guildId, map);
      });
    }

    const wet = readJSONSafe(PATHS.wetlist);
    if (wet && typeof wet === 'object') {
      Object.entries(wet).forEach(([guildId, arr]) => client.state.wetlist.set(guildId, new Map(arr)));
    }

    const dogs = readJSONSafe(PATHS.doglocks);
    if (dogs && typeof dogs === 'object') {
      Object.entries(dogs).forEach(([guildId, arr]) => client.state.doglocks.set(guildId, new Map(arr)));
    }

    const pmv = readJSONSafe(PATHS.permmv);
    if (pmv && typeof pmv === 'object') {
      Object.entries(pmv).forEach(([guildId, arr]) => client.state.permmv.set(guildId, new Set(arr)));
    }

    const parr = readJSONSafe(PATHS.permaddrole);
    if (parr && typeof parr === 'object') {
      Object.entries(parr).forEach(([guildId, arr]) => client.state.permaddrole.set(guildId, new Map(arr)));
    }

    const fab = readJSONSafe(PATHS.fabulous);
    if (fab && typeof fab === 'object') {
      Object.entries(fab).forEach(([guildId, arr]) => client.state.fabulous.set(guildId, new Set(arr)));
    }

    const smash = readJSONSafe(PATHS.smashChannels);
    if (smash && typeof smash === 'object') {
      Object.entries(smash).forEach(([guildId, arr]) => client.state.smashChannels.set(guildId, new Set(arr)));
    }

    const inv = readJSONSafe(PATHS.invitesCache);
    if (inv && typeof inv === 'object') {
      Object.entries(inv).forEach(([guildId, arr]) => client.state.invites.set(guildId, new Map(arr)));
    }
  } catch (e) {
    console.error('loadAll error', e);
  }
}

loadAll();
setInterval(persistAll, 60_000);

/* ---------------- SMALL HELPERS ---------------- */
function isOwner(id) { return CONFIG.OWNER_IDS.includes(String(id)); }
function isWL(member) {
  if (!member) return false;
  if (isOwner(member.id)) return true;
  if (member.roles && member.roles.cache.some(r => r.name === CONFIG.WL_ROLE_NAME)) return true;
  if (client.state.whitelist.has(member.id)) return true;
  return false;
}
function isAdmin(member) {
  if (!member) return false;
  if (isOwner(member.id)) return true;
  if (member.permissions && member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (member.roles && member.roles.cache.some(r => r.name === CONFIG.ADMIN_ROLE_NAME)) return true;
  if (client.state.adminUsers.has(member.id)) return true;
  return false;
}
function canActOn(executorMember, targetMember) {
  if (!executorMember || !targetMember) return false;
  // owner bypass
  if (isOwner(executorMember.id)) return true;
  // compare role positions
  const execPos = executorMember.roles.highest ? executorMember.roles.highest.position : 0;
  const targPos = targetMember.roles.highest ? targetMember.roles.highest.position : 0;
  return execPos > targPos;
}
function shortEmbed(title, desc) {
  return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(CONFIG.MAIN_COLOR);
}

/* ---------------- INVITE TRACKING ---------------- */
async function cacheGuildInvites(guild) {
  try {
    if (!guild || !guild.available) return;
    const invites = await guild.invites.fetch();
    const map = new Map();
    invites.each(inv => map.set(inv.code, inv.uses));
    client.state.invites.set(guild.id, map);
  } catch (e) { /* ignore */ }
}

client.on('ready', async () => {
  console.log('Bot ready', client.user.tag);
  // cache all invites
  for (const guild of client.guilds.cache.values()) {
    await cacheGuildInvites(guild);
    client.state.inviteOwnerCount.set(guild.id, new Map()); // init
  }
});

/* ---------------- SNIPES (messageDelete) ---------------- */
client.on('messageDelete', async (message) => {
  try {
    if (!message) return;
    if (message.author && message.author.bot) return;
    const data = {
      content: message.content || null,
      authorTag: message.author ? message.author.tag : null,
      attachments: message.attachments.map(a => a.url),
      createdAt: Date.now()
    };
    client.state.snipes.set(message.channel.id, data);
  } catch (e) {
    console.error('messageDelete snipe error', e);
  }
});

/* ---------------- GUILD MEMBER ADD / ANTIRAID / INVITE HANDLING / GHOSTJOINS ---------------- */
client.on('guildMemberAdd', async (member) => {
  try {
    // blacklist auto kick
    const gBl = client.state.blacklist.get(member.guild.id);
    if (gBl && gBl.has(member.id)) {
      // kick after a short delay
      setTimeout(() => member.kick('Utilisateur blacklisté (auto kick à l\'entrée)').catch(()=>{}), 1500);
      return;
    }

    // invite count detection
    try {
      const oldInvs = client.state.invites.get(member.guild.id) || new Map();
      const newInvs = await member.guild.invites.fetch();
      const inviter = newInvs.find(i => (oldInvs.get(i.code) || 0) < i.uses);
      // update cache
      const map = new Map();
      newInvs.each(inv => map.set(inv.code, inv.uses));
      client.state.invites.set(member.guild.id, map);
      // update inviter count
      if (inviter) {
        const ownerMap = client.state.inviteOwnerCount.get(member.guild.id) || new Map();
        ownerMap.set(String(inviter.inviter?.id || 'unknown'), (ownerMap.get(String(inviter.inviter?.id || 'unknown')) || 0) + 1);
        client.state.inviteOwnerCount.set(member.guild.id, ownerMap);
        // Invite logger: send embed if configured
        const chId = client.state.ghostjoins.get(member.guild.id); // reuse ghostjoins as invite-logger channel if set
        if (chId) {
          const channel = member.guild.channels.cache.get(chId);
          if (channel && channel.isTextBased && channel.permissionsFor(member.guild.members.me).has(PermissionsBitField.Flags.SendMessages)) {
            const embed = new EmbedBuilder()
              .setTitle(`Nouveau membre sur ${member.guild.name}`)
              .setDescription(`${member.user} vient de rejoindre.\nInvité par: ${inviter.inviter ? `${inviter.inviter.tag}` : 'inconnu'}`)
              .setColor(CONFIG.MAIN_COLOR)
              .setTimestamp()
              .setFooter({ text: `Invitations totales de l'invitant: ${ownerMap.get(String(inviter.inviter?.id || 'unknown')) || 0}` });
            // add thumbnail avatar to right: embed thumbnail will appear right-ish
            embed.setThumbnail(member.user.displayAvatarURL({ size: 1024 }));
            channel.send({ embeds: [embed] }).catch(()=>{});
          }
        }
      }
    } catch (e) { /* ignore invite fetch errors */ }

    // ghostjoins behavior: mention in a channel but delete quickly to ghostping
    const ghostChannelId = client.state.ghostjoins.get(member.guild.id);
    if (ghostChannelId) {
      const ch = member.guild.channels.cache.get(ghostChannelId);
      if (ch && ch.isTextBased && ch.permissionsFor(member.guild.members.me).has(PermissionsBitField.Flags.SendMessages)) {
        try {
          const m = await ch.send(`${member.user}`); // mention
          setTimeout(() => m.delete().catch(()=>{}), 1200);
        } catch (e) {}
      }
    }

    // anti-raid: push join timestamp & evaluate threshold
    if (CONFIG.ANTIRAID.enabled) {
      const arr = client.state.recentJoins.get(member.guild.id) || [];
      const now = Date.now();
      arr.push(now);
      const windowed = arr.filter(t => now - t < CONFIG.ANTIRAID.joinWindowMs);
      client.state.recentJoins.set(member.guild.id, windowed);
      if (windowed.length >= CONFIG.ANTIRAID.joinThreshold) {
        // action: kick accounts that are younger than minAccountAge
        const guildMembers = await member.guild.members.fetch().catch(()=>null);
        if (guildMembers) {
          for (const [id, m] of guildMembers) {
            try {
              const accountAge = Date.now() - m.user.createdTimestamp;
              if (accountAge < CONFIG.ANTIRAID.minAccountAgeMs && !m.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await m.kick('Anti-raid : comptes récents détectés lors d\'un pic de joins').catch(()=>{});
              }
            } catch (e) {}
          }
        }
        // optional log to system channel
        if (member.guild.systemChannel && member.guild.systemChannel.permissionsFor(member.guild.members.me).has(PermissionsBitField.Flags.SendMessages)) {
          member.guild.systemChannel.send({ embeds: [shortEmbed('Anti-raid', 'Actions anti-raid exécutées : kick comptes suspects.')] }).catch(()=>{});
        }
      }
    }
  } catch (e) {
    console.error('guildMemberAdd error', e);
  }
});

/* ---------------- VOICE / FABULOUSBOT PROTECTIONS ---------------- */
client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    // fabulous protection: if a protected user is moved/muted/deafened/kicked, revert action and punish actor
    const guildId = newState.guild.id;
    const protectedSet = client.state.fabulous.get(guildId) || new Set();
    // check protected user changed
    const changedUser = newState.member;
    if (changedUser && protectedSet.has(changedUser.id)) {
      // If someone tried to move him from a voice channel, move back
      if (oldState.channelId && !newState.channelId) {
        // disconnected: try rejoin to same channel (best effort)
        const channelId = oldState.channelId;
        try {
          await changedUser.voice.setChannel(channelId).catch(()=>{});
        } catch (e) {}
      }
      // if muted/suppressed: if someone muted them (server mute) — we can try to unmute and mute the perpetrator
      if (oldState.serverMute !== newState.serverMute && newState.serverMute === true) {
        // find who changed? Not trivial. We'll simply unmute the protected user if we can.
        try { await changedUser.voice.setMute(false).catch(()=>{}); } catch (e) {}
      }
    }
  } catch (e) {
    console.error('voiceStateUpdate error', e);
  }
});

/* ---------------- MESSAGE CREATE: COMMANDS + SMASH enforcement ---------------- */
client.on('messageCreate', async (message) => {
  try {
    if (!message.guild || message.author.bot) {
      return;
    }

    // SMASH channel enforcement: if channel is smash-only, delete plain text messages and allow only attachments
    const smashSet = client.state.smashChannels.get(message.guild.id) || new Set();
    if (smashSet.has(message.channel.id)) {
      // Allow attachments only (images/videos)
      const hasAttachment = message.attachments && message.attachments.size > 0;
      const hasEmbedImage = message.embeds && message.embeds.some(e => e.type === 'image' || e.thumbnail || e.image);
      if (!hasAttachment && !hasEmbedImage) {
        // delete the message
        await message.delete().catch(()=>{});
        return;
      }
    }

    // If this is a media message in a smash channel: auto react and create thread
    if ((message.attachments && message.attachments.size > 0) && smashSet.has(message.channel.id)) {
      try {
        await message.react('✓').catch(()=>{});
        await message.react('✘').catch(()=>{});
      } catch (e) {}
      // start thread
      try {
        if (message.channel.isTextBased()) {
          await message.startThread({
            name: `smash-${message.author.username}-${Date.now()}`,
            autoArchiveDuration: CONFIG.SMASH_THREAD_ARCHIVE_MINUTES,
            reason: 'Thread auto pour smash'
          }).catch(()=>{});
        }
      } catch (e) {}
    }

    // Command handling
    if (!message.content.startsWith(CONFIG.PREFIX)) return;
    const raw = message.content.slice(CONFIG.PREFIX.length).trim();
    if (!raw) return;
    const parts = raw.split(/\s+/);
    const cmd = parts.shift().toLowerCase();
    const args = parts;

    // HELP (short one-line descriptions)
    if (cmd === 'help' || cmd === 'h') {
      const lines = [
        '+snipe — affiche le dernier message supprimé (texte + médias).',
        '+lock — verrouille le salon; seuls WL/admin/owner peuvent écrire.',
        '+unlock — déverrouille le salon.',
        '+dog @user — verrouille le pseudo de la cible (save old nick).',
        '+undog @user — restaure le pseudo verrouillé.',
        '+wet @user [raison] — ban "wet" qui ne peut être déban que par +unwet (WL/owner only).',
        '+unwet @user — débannir une personne wet (WL/owner only).',
        '+bl @user [raison] — blacklist l\'utilisateur (WL/admin/owner).',
        '+unbl @user — enlève de la blacklist (WL/admin/owner).',
        '+blinfo @user — affiche les infos de blacklist en embed.',
        '+pic @user — affiche avatar global + avatar serveur.',
        '+Ghostjoins <channelId> — toggle ghostjoins pour guild (owner/WL only).',
        '+inviteloger <channelId> — active l\'invite logger au salon donné.',
        '+unbanall — unban tout (mais les +bl restent bl).',
        '+permmv @Role — autorise un rôle à utiliser +mv.',
        '+delpermmv @Role — retire cette permission.',
        '+PermmvRolelist — liste rôles autorisés à +mv.',
        '+Permaddrole @role <count> — donne droit d\'ajouter des roles <count> fois.',
        '+delpermaddrole @role — retire la permission addrole.',
        '+Fabulousbot @user — protège ce user (owner bot) contre actions; owner only.',
        '+smash — toggle smash pour ce salon (uniquement images/vidéos autorisées).',
        '+antiraid <on|off> — active/désactive l\'antiraid.',
        '+backup save — sauvegarde l\'état du bot.',
        '+backup load <filename> — restaure un backup (WL/owner only).'
      ];
      return message.channel.send({ embeds: [new EmbedBuilder().setTitle('Commandes (courtes)').setDescription(lines.join('\n')).setColor(CONFIG.MAIN_COLOR)] });
    }

    /* ---------------- +snipe ---------------- */
    if (cmd === 'snipe') {
      const s = client.state.snipes.get(message.channel.id);
      if (!s) return message.reply('Aucun message supprimé récent dans ce salon.');
      const emb = new EmbedBuilder()
        .setTitle('Snipe')
        .setDescription(s.content || '(pas de texte)')
        .addFields({ name: 'Auteur', value: s.authorTag || 'inconnu', inline: true })
        .setColor(CONFIG.MAIN_COLOR)
        .setTimestamp(new Date(s.createdAt));
      if (s.attachments && s.attachments.length) {
        emb.setImage(s.attachments[0]);
        emb.addFields({ name: 'Pièces jointes', value: s.attachments.join('\n') });
      }
      return message.channel.send({ embeds: [emb] });
    }

    /* ---------------- +lock / +unlock ---------------- */
    if (cmd === 'lock' || cmd === 'unlock') {
      if (!isWL(message.member) && !isAdmin(message.member) && !isOwner(message.author.id)) return sendTempErr(message, "Accès refusé.");
      const channel = message.channel;
      const everyone = message.guild.roles.everyone;
      if (cmd === 'lock') {
        await channel.permissionOverwrites.edit(everyone, { SendMessages: false }).catch(()=>{});
        // allow WL/admin/owner to send
        const allow = new Set([ ...client.state.whitelist, ...client.state.adminUsers, ...CONFIG.OWNER_IDS ]);
        for (const id of allow) {
          if (!id) continue;
          await channel.permissionOverwrites.edit(id, { SendMessages: true }).catch(()=>{});
        }
        return message.channel.send('✓ Salon verrouillé (seuls WL/admin/owner peuvent parler).');
      } else {
        // unlock: reset overwrite for everyone and for known ids we set to null
        await channel.permissionOverwrites.edit(everyone, { SendMessages: null }).catch(()=>{});
        const allow = new Set([ ...client.state.whitelist, ...client.state.adminUsers, ...CONFIG.OWNER_IDS ]);
        for (const id of allow) {
          await channel.permissionOverwrites.edit(id, { SendMessages: null }).catch(()=>{});
        }
        return message.channel.send('✓ Salon déverrouillé.');
      }
    }

    /* ---------------- +dog / +undog ---------------- */
    if (cmd === 'dog' || cmd === 'undog') {
      if (!isWL(message.member) && !isOwner(message.author.id)) return sendTempErr(message, "Accès refusé.");
      const target = parseMemberFromArg(message, args[0]);
      if (!target) return message.reply('Usage: +dog @user OR +undog @user');
      const guildId = message.guild.id;
      if (cmd === 'dog') {
        // store old nickname, set new locked name format e.g. 🦮displayname
        const oldNick = target.displayName;
        const locked = `🦮${oldNick}`;
        let map = client.state.doglocks.get(guildId);
        if (!map) { map = new Map(); client.state.doglocks.set(guildId, map); }
        map.set(target.id, { oldNick, by: message.author.id, date: Date.now() });
        await target.setNickname(locked).catch(()=>{});
        persistAll();
        return message.channel.send(`✓ ${target.user.tag} pseudo verrouillé en \`${locked}\``);
      } else {
        const map = client.state.doglocks.get(guildId);
        if (!map || !map.has(target.id)) return message.reply('Aucun dog lock trouvé pour cet utilisateur.');
        const info = map.get(target.id);
        await target.setNickname(info.oldNick).catch(()=>{});
        map.delete(target.id);
        persistAll();
        return message.channel.send(`✓ ${target.user.tag} pseudo restauré en \`${info.oldNick}\``);
      }
    }

    /* ---------------- +wet / +unwet ---------------- */
    if (cmd === 'wet' || cmd === 'unwet') {
      if (!isWL(message.member) && !isOwner(message.author.id)) return sendTempErr(message, "Accès refusé.");
      if (!args[0]) return message.reply('Usage: +wet @user [raison]  OR +unwet @user');
      const target = parseMemberFromArg(message, args[0]);
      if (!target) return message.reply('Utilisateur introuvable.');
      if (!canActOn(message.member, target)) {
        await message.reply('Vous ne pouvez pas effectuer cette commande sur votre supérieur !').then(m => setTimeout(()=>m.delete().catch(()=>{}),2000));
        return;
      }
      const guildId = message.guild.id;
      if (cmd === 'wet') {
        const reason = args.slice(1).join(' ') || 'non fournie';
        // ban target and mark in wetlist
        await message.guild.members.ban(target.id, { reason: `WET by ${message.author.tag}: ${reason}` }).catch(()=>{});
        let gmap = client.state.wetlist.get(guildId);
        if (!gmap) { gmap = new Map(); client.state.wetlist.set(guildId, gmap); }
        gmap.set(target.id, { by: message.author.id, reason, date: Date.now() });
        persistAll();
        return message.channel.send(`✓ ${target.user.tag} a été WET. Seuls WL/owner peuvent +unwet.`);
      } else {
        // unwet
        const gmap = client.state.wetlist.get(guildId);
        if (!gmap || !gmap.has(target.id)) return message.reply('Cet utilisateur n\'est pas wet.');
        // only WL/owner allowed (we checked earlier)
        await message.guild.members.unban(target.id, 'Unwet by WL/owner').catch(()=>{});
        gmap.delete(target.id);
        persistAll();
        return message.channel.send(`✓ ${target.user.tag} a été débanni (unwet).`);
      }
    }

    /* ---------------- +bl / +unbl / +blinfo ---------------- */
    if (cmd === 'bl' || cmd === 'unbl' || cmd === 'blinfo') {
      if (!isWL(message.member) && !isAdmin(message.member) && !isOwner(message.author.id)) return sendTempErr(message, "Accès refusé.");
      if (!args[0]) return message.reply('Usage: +bl @user [raison] OR +unbl @user OR +blinfo @user');
      const targetId = extractIdFromMention(args[0]);
      if (!targetId) return message.reply('Utilisateur introuvable.');
      const guildId = message.guild.id;
      if (cmd === 'bl') {
        const reason = args.slice(1).join(' ') || 'non fournie';
        let gmap = client.state.blacklist.get(guildId);
        if (!gmap) { gmap = new Map(); client.state.blacklist.set(guildId, gmap); }
        gmap.set(targetId, { reason, by: message.author.id, date: Date.now() });
        // try DM
        try {
          const user = await client.users.fetch(targetId).catch(()=>null);
          if (user) {
            await user.send(`Tu as été blacklisté\nRaison: ${reason}`).catch(()=>{});
          }
        } catch (e) {}
        persistAll();
        return message.channel.send(`✓ ${targetId} ajouté à la blacklist.`);
      } else if (cmd === 'unbl') {
        const gmap = client.state.blacklist.get(guildId);
        if (!gmap || !gmap.has(targetId)) return message.reply('Cet utilisateur n\'est pas blacklisté.');
        gmap.delete(targetId);
        persistAll();
        return message.channel.send(`✓ ${targetId} retiré de la blacklist.`);
      } else {
        // blinfo
        const gmap = client.state.blacklist.get(guildId);
        if (!gmap || !gmap.has(targetId)) return message.reply('Aucune info blacklist pour cet utilisateur.');
        const info = gmap.get(targetId);
        const embed = new EmbedBuilder()
          .setTitle('📜 Informations sur le Bannissement')
          .addFields(
            { name: '👤 Utilisateur', value: `Identifiant : ${targetId}`, inline: false },
            { name: '📄 Informations', value: `Raison : ${info.reason || 'non fournie'}`, inline: false },
            { name: '👮‍♂️ Modérateur', value: `Identifiant : ${info.by}\nDate : ${new Date(info.date).toLocaleString()}`, inline: false }
          ).setColor(CONFIG.MAIN_COLOR);
        return message.channel.send({ embeds: [embed] });
      }
    }

    /* ------------- +pic ------------- */
    if (cmd === 'pic') {
      const target = args[0] ? (await message.guild.members.fetch({ user: extractIdFromMention(args[0]) }).catch(()=>null)) : message.member;
      if (!target) return message.reply('Utilisateur introuvable.');
      const userAvatar = target.user.displayAvatarURL({ dynamic: true, size: 1024 });
      const guildAvatar = target.displayAvatarURL ? target.displayAvatarURL({ dynamic: true, size: 1024 }) : null;
      const emb = new EmbedBuilder().setTitle(`Avatars de ${target.user.tag}`).setColor(CONFIG.MAIN_COLOR)
        .setImage(userAvatar)
        .addFields({ name: 'Global', value: userAvatar || '—' , inline: true });
      if (guildAvatar) emb.addFields({ name: 'Serveur', value: guildAvatar, inline: true });
      return message.channel.send({ embeds: [emb] });
    }

    /* ------------- Ghostjoins toggle ------------- */
    if (cmd === 'ghostjoins') {
      if (!isOwner(message.author.id) && !isWL(message.member)) return sendTempErr(message, "Accès refusé.");
      // usage: +Ghostjoins <channelId> (toggle)
      const chId = args[0];
      if (!chId) {
        // toggle off if exists
        if (client.state.ghostjoins.has(message.guild.id)) {
          client.state.ghostjoins.delete(message.guild.id);
          persistAll();
          return message.channel.send('✘ Ghostjoins désactivé.');
        } else {
          return message.reply('Usage: +Ghostjoins <channelId> pour activer ou relance la commande dans le salon pour désactiver.');
        }
      } else {
        // validate channel
        const ch = message.guild.channels.cache.get(chId);
        if (!ch || !ch.isTextBased()) return message.reply('Salon introuvable ou non textuel.');
        client.state.ghostjoins.set(message.guild.id, chId);
        persistAll();
        return message.channel.send(`✓ Ghostjoins activé sur <#${chId}>.`);
      }
    }

    /* ------------- +inviteloger ------------- */
    if (cmd === 'inviteloger') {
      if (!isOwner(message.author.id) && !isWL(message.member)) return sendTempErr(message, "Accès refusé.");
      const chId = args[0];
      if (!chId) return message.reply('Usage: +inviteloger <channelId>');
      const ch = message.guild.channels.cache.get(chId);
      if (!ch || !ch.isTextBased()) return message.reply('Salon introuvable.');
      client.state.ghostjoins.set(message.guild.id, chId); // reuse ghostjoins mapping for invite logger storage
      persistAll();
      return message.channel.send(`✓ Invite logger activé sur <#${chId}>.`);
    }

    /* ------------- +unbanall ------------- */
    if (cmd === 'unbanall') {
      if (!isOwner(message.author.id) && !isAdmin(message.member) && !isWL(message.member)) return sendTempErr(message, "Accès refusé.");
      // unban everyone except blacklisted (per guild)
      const bans = await message.guild.bans.fetch().catch(()=>null);
      if (!bans) return message.reply('Impossible de récupérer la liste des bans.');
      const gBl = client.state.blacklist.get(message.guild.id) || new Map();
      let count = 0;
      for (const ban of bans.values()) {
        const uid = ban.user.id;
        if (gBl && gBl.has(uid)) continue; // keep bl banned
        try {
          await message.guild.members.unban(uid, `Unbanned by +unbanall by ${message.author.tag}`).catch(()=>{});
          count++;
        } catch (e) {}
      }
      return message.channel.send(`✓ Unbanall terminé : ${count} utilisateurs débannis (les blacklistés restent bannis).`);
    }

    /* ------------- permmv / delpermmv / PermmvRolelist ------------- */
    if (cmd === 'permmv' || cmd === 'delpermmv' || cmd === 'permmvrolelist') {
      if (!isOwner(message.author.id) && !isAdmin(message.member) && !isWL(message.member)) return sendTempErr(message, "Accès refusé.");
      if (cmd === 'permmvrolelist') {
        const set = client.state.permmv.get(message.guild.id) || new Set();
        const rolesArr = [...set].map(id => {
          const r = message.guild.roles.cache.get(id);
          return r ? `${r.name} (${r.id})` : id;
        });
        return message.channel.send({ embeds: [shortEmbed('Roles permmv', rolesArr.length ? rolesArr.join('\n') : 'Aucun rôle configuré')] });
      }
      const role = parseRoleFromArg(message, args[0]);
      if (!role) return message.reply('Usage: +permmv @Role OR +delpermmv @Role');
      let set = client.state.permmv.get(message.guild.id);
      if (!set) { set = new Set(); client.state.permmv.set(message.guild.id, set); }
      if (cmd === 'permmv') {
        set.add(role.id);
        persistAll();
        return message.channel.send(`✓ Le rôle ${role.name} peut maintenant utiliser +mv.`);
      } else {
        set.delete(role.id);
        persistAll();
        return message.channel.send(`✓ Le rôle ${role.name} a perdu la permission +mv.`);
      }
    }

    /* ------------- permaddrole / delpermaddrole ------------- */
    if (cmd === 'permaddrole' || cmd === 'delpermaddrole') {
      if (!isOwner(message.author.id) && !isAdmin(message.member) && !isWL(message.member)) return sendTempErr(message, "Accès refusé.");
      const role = parseRoleFromArg(message, args[0]);
      if (!role) return message.reply('Usage: +Permaddrole @role <count> OR +delpermaddrole @role');
      if (cmd === 'permaddrole') {
        const count = parseInt(args[1], 10);
        if (!count || count <= 0) return message.reply('Donne un count positif (ex: 3).');
        let map = client.state.permaddrole.get(message.guild.id);
        if (!map) { map = new Map(); client.state.permaddrole.set(message.guild.id, map); }
        map.set(role.id, count);
        persistAll();
        return message.channel.send(`✓ ${role.name} peut maintenant utiliser +addrole ${count} fois.`);
      } else {
        const map = client.state.permaddrole.get(message.guild.id);
        if (map) { map.delete(role.id); persistAll(); }
        return message.channel.send(`✓ Permission +addrole retirée pour ${role.name}.`);
      }
    }

    /* ------------- Fabulousbot protection ------------- */
    if (cmd === 'fabulousbot') {
      if (!isOwner(message.author.id)) return sendTempErr(message, "Accès refusé (owner only).");
      const target = parseMemberFromArg(message, args[0]);
      if (!target) return message.reply('Usage: +Fabulousbot @user');
      const set = client.state.fabulous.get(message.guild.id) || new Set();
      set.add(target.id);
      client.state.fabulous.set(message.guild.id, set);
      persistAll();
      return message.channel.send(`✓ ${target.user.tag} est maintenant protégé par Fabulousbot.`);
    }

    /* ------------- smash toggle ------------- */
    if (cmd === 'smash') {
      if (!isOwner(message.author.id) && !isWL(message.member)) return sendTempErr(message, "Accès refusé.");
      const set = client.state.smashChannels.get(message.guild.id) || new Set();
      if (set.has(message.channel.id)) {
        set.delete(message.channel.id);
        client.state.smashChannels.set(message.guild.id, set);
        persistAll();
        return message.channel.send('✘ Smash désactivé pour ce salon.');
      } else {
        set.add(message.channel.id);
        client.state.smashChannels.set(message.guild.id, set);
        persistAll();
        return message.channel.send('✓ Smash activé pour ce salon — seules images/vidéos autorisées; réactions auto ✓/✘ et thread créé.');
      }
    }

    /* ------------- antiraid toggle ------------- */
    if (cmd === 'antiraid') {
      if (!isOwner(message.author.id) && !isWL(message.member)) return sendTempErr(message, "Accès refusé.");
      const arg = args[0] ? args[0].toLowerCase() : null;
      if (arg === 'on') {
        CONFIG.ANTIRAID.enabled = true;
        return message.channel.send('✓ Anti-raid activé.');
      } else if (arg === 'off') {
        CONFIG.ANTIRAID.enabled = false;
        return message.channel.send('✘ Anti-raid désactivé.');
      } else {
        return message.reply('Usage: +antiraid on|off');
      }
    }

    /* ------------- backup save/load ------------- */
    if (cmd === 'backup') {
      if (!isOwner(message.author.id) && !isWL(message.member)) return sendTempErr(message, "Accès refusé.");
      const sub = args[0] ? args[0].toLowerCase() : null;
      if (sub === 'save') {
        // gather snapshot
        const state = {
          meta: { createdAt: new Date().toISOString(), guild: { id: message.guild.id, name: message.guild.name } },
          whitelist: [...client.state.whitelist],
          adminUsers: [...client.state.adminUsers],
          blacklist: (() => {
            const o = {};
            client.state.blacklist.forEach((map, gid) => o[gid] = Array.from(map.entries()));
            return o;
          })(),
          wetlist: (() => {
            const o = {};
            client.state.wetlist.forEach((map, gid) => o[gid] = Array.from(map.entries()));
            return o;
          })(),
          doglocks: (() => {
            const o = {};
            client.state.doglocks.forEach((map, gid) => o[gid] = Array.from(map.entries()));
            return o;
          })(),
          permmv: (() => {
            const o = {};
            client.state.permmv.forEach((s, gid) => o[gid] = [...s]);
            return o;
          })(),
          permaddrole: (() => {
            const o = {};
            client.state.permaddrole.forEach((m, gid) => o[gid] = Array.from(m.entries()));
            return o;
          })(),
          fabulous: (() => {
            const o = {};
            client.state.fabulous.forEach((s, gid) => o[gid] = [...s]);
            return o;
          })(),
          smashChannels: (() => {
            const o = {};
            client.state.smashChannels.forEach((s, gid) => o[gid] = [...s]);
            return o;
          })()
        };
        const fname = `backup_${message.guild.id}_${Date.now()}.json`;
        const out = path.join(PATHS.backupsDir, fname);
        try {
          writeAtomic(out, state);
          return message.channel.send(`✓ Backup saved: \`${fname}\``);
        } catch (e) {
          console.error('backup save error', e);
          return message.channel.send('✘ Erreur lors de la sauvegarde du backup.');
        }
      } else if (sub === 'load') {
        const fname = args[1];
        if (!fname) return message.reply('Usage: +backup load <filename>');
        const p = path.join(PATHS.backupsDir, fname);
        if (!fs.existsSync(p)) return message.reply('Fichier backup introuvable.');
        try {
          const state = JSON.parse(fs.readFileSync(p, 'utf8'));
          // restore (careful)
          client.state.whitelist = new Set(state.whitelist || []);
          client.state.adminUsers = new Set(state.adminUsers || []);
          // more: restore objects
          if (state.blacklist && typeof state.blacklist === 'object') {
            client.state.blacklist = new Map();
            Object.entries(state.blacklist).forEach(([gid, arr]) => client.state.blacklist.set(gid, new Map(arr)));
          }
          if (state.wetlist && typeof state.wetlist === 'object') {
            client.state.wetlist = new Map();
            Object.entries(state.wetlist).forEach(([gid, arr]) => client.state.wetlist.set(gid, new Map(arr)));
          }
          if (state.doglocks && typeof state.doglocks === 'object') {
            client.state.doglocks = new Map();
            Object.entries(state.doglocks).forEach(([gid, arr]) => client.state.doglocks.set(gid, new Map(arr)));
          }
          if (state.permmv && typeof state.permmv === 'object') {
            client.state.permmv = new Map();
            Object.entries(state.permmv).forEach(([gid, arr]) => client.state.permmv.set(gid, new Set(arr)));
          }
          if (state.permaddrole && typeof state.permaddrole === 'object') {
            client.state.permaddrole = new Map();
            Object.entries(state.permaddrole).forEach(([gid, arr]) => client.state.permaddrole.set(gid, new Map(arr)));
          }
          if (state.fabulous && typeof state.fabulous === 'object') {
            client.state.fabulous = new Map();
            Object.entries(state.fabulous).forEach(([gid, arr]) => client.state.fabulous.set(gid, new Set(arr)));
          }
          if (state.smashChannels && typeof state.smashChannels === 'object') {
            client.state.smashChannels = new Map();
            Object.entries(state.smashChannels).forEach(([gid, arr]) => client.state.smashChannels.set(gid, new Set(arr)));
          }
          persistAll();
          return message.channel.send(`✓ Backup \`${fname}\` chargé.`);
        } catch (e) {
          console.error('backup load error', e);
          return message.channel.send('✘ Erreur lors du chargement du backup.');
        }
      } else {
        return message.reply('Usage: +backup save OR +backup load <filename>');
      }
    }

  } catch (e) {
    console.error('messageCreate top-level error', e);
  }
});

/* ---------------- UTILS: parsing ---------------- */
function extractIdFromMention(mention) {
  if (!mention) return null;
  const m = mention.match(/^<@!?(\d+)>$/);
  if (m) return m[1];
  if (/^\d+$/.test(mention)) return mention;
  return null;
}
function parseMemberFromArg(message, arg) {
  if (!arg) return null;
  const id = extractIdFromMention(arg);
  if (!id) return null;
  return message.guild.members.cache.get(id) || null;
}
function parseRoleFromArg(message, arg) {
  if (!arg) return null;
  const m = arg.match(/^<@&(\d+)>$/);
  const id = m ? m[1] : ( /^\d+$/.test(arg) ? arg : null );
  return id ? (message.guild.roles.cache.get(id) || null) : null;
}
function sendTempErr(message, text) {
  return message.channel.send(text).then(m => setTimeout(()=>m.delete().catch(()=>{}), 2000)).catch(()=>{});
}

/* ---------------- LOGIN ---------------- */
client.login(TOKEN).catch(err => {
  console.error('Login error', err);
  process.exit(1);
});
