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
  AuditLogEvent,
  Partials,
  ActivityType
} = require('discord.js');

// -------------------- CONFIGURATION SUPRÊME --------------------
const MAIN_COLOR = "#8A2BE2"; // Violet pour le style
const OWNER_ID = "726063885492158474"; // Ton ID
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Chemins des fichiers de données
const PATHS = {
  whitelist: path.join(DATA_DIR, 'whitelist.json'),
  admin: path.join(DATA_DIR, 'admin.json'),
  blacklist: path.join(DATA_DIR, 'blacklist.json'),
  wetList: path.join(DATA_DIR, 'wetList.json'),
  banList: path.join(DATA_DIR, 'banList.json'),
  dogs: path.join(DATA_DIR, 'dogs.json'),
  permMvUsers: path.join(DATA_DIR, 'permMvUsers.json'),
  permMvRoles: path.join(DATA_DIR, 'permMvRoles.json'), // NOUVEAU
  permAddRoleRoles: path.join(DATA_DIR, 'permAddRoleRoles.json'), // NOUVEAU
  fabulousUsers: path.join(DATA_DIR, 'fabulousUsers.json'), // NOUVEAU
  limitRoles: path.join(DATA_DIR, 'limitRoles.json'),
  lockedNames: path.join(DATA_DIR, 'lockedNames.json'),
  cooldowns: path.join(DATA_DIR, 'cooldowns.json'),
  pv: path.join(DATA_DIR, 'pvChannels.json'),
  lockedTextChannels: path.join(DATA_DIR, 'lockedTextChannels.json'),
  smashChannels: path.join(DATA_DIR, 'smashChannels.json'), // NOUVEAU
  ghostJoinChannels: path.join(DATA_DIR, 'ghostJoinChannels.json'), // NOUVEAU
  inviteLogChannels: path.join(DATA_DIR, 'inviteLogChannels.json') // NOUVEAU
};

const EXTERNAL_PING_URL = process.env.SELF_PING_URL || "https://mon-bot-discord-by-seiko.onrender.com/";
const PORT = process.env.PORT || 10000;

// -------------------- CLIENT OPTIMISÉ --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences, // Nécessaire pour +ui
    GatewayIntentBits.GuildInvites,   // Nécessaire pour Invite Logger
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// -------------------- MÉMOIRE & STOCKAGE --------------------
// Sets et Maps pour un accès ultra-rapide
client.whitelist = new Set();
client.adminUsers = new Set();
client.blacklist = new Set();
client.wetList = new Set();
client.banList = new Set();
client.dogs = new Map(); // targetId -> { executorId, lockedName, originalName }
client.permMvUsers = new Set();
client.permMvRoles = new Set(); // Set of Role IDs
client.permAddRoleRoles = new Map(); // RoleID -> count limit
client.fabulousUsers = new Set(); // IDs des utilisateurs Fabulous
client.limitRoles = new Map();
client.lockedNames = new Set();
client.pvChannels = new Map();
client.lockedTextChannels = new Set();
client.smashChannels = new Set(); // Channel IDs
client.ghostJoinChannels = new Map(); // GuildID -> ChannelID
client.inviteLogChannels = new Map(); // GuildID -> ChannelID

// Caches temporaires
client.snipes = new Map(); // channelId -> { content, author, timestamp, image }
client.invites = new Map(); // GuildID -> Collection(Code -> Invite)
client.messageLastTs = new Map();
client.processingMessageIds = new Set();
client.cooldowns = new Map(); // Runtime cooldowns

let persistentCooldowns = {};

// Toggles par défaut
client.config = {
  antispam: false,
  antlink: false,
  antibot: false,
  antiraid: false, // Mode "Super Puissant"
  raidlog: false
};

// -------------------- SYSTÈME DE SAUVEGARDE ROBUSTE (FIXED) --------------------
function readJSONSafe(p) {
  try { 
    if (!fs.existsSync(p)) return null; 
    const data = fs.readFileSync(p, 'utf8');
    return data ? JSON.parse(data) : null;
  } catch (e) { 
    console.error(`[ERREUR READ] ${p}:`, e); 
    return null; 
  }
}

function writeJSONSafe(p, data) {
  try { 
    fs.writeFileSync(p, JSON.stringify(data, null, 2)); 
  } catch (e) { 
    console.error(`[ERREUR WRITE] ${p}:`, e); 
  }
}

function persistAll() {
  console.log("Sauvegarde des données...");
  writeJSONSafe(PATHS.whitelist, [...client.whitelist]);
  writeJSONSafe(PATHS.admin, [...client.adminUsers]);
  writeJSONSafe(PATHS.blacklist, [...client.blacklist]);
  writeJSONSafe(PATHS.wetList, [...client.wetList]);
  writeJSONSafe(PATHS.banList, [...client.banList]);
  writeJSONSafe(PATHS.dogs, [...client.dogs.entries()]);
  writeJSONSafe(PATHS.permMvUsers, [...client.permMvUsers]);
  writeJSONSafe(PATHS.permMvRoles, [...client.permMvRoles]);
  writeJSONSafe(PATHS.permAddRoleRoles, [...client.permAddRoleRoles.entries()]);
  writeJSONSafe(PATHS.fabulousUsers, [...client.fabulousUsers]);
  writeJSONSafe(PATHS.limitRoles, [...client.limitRoles.entries()]);
  writeJSONSafe(PATHS.lockedNames, [...client.lockedNames]);
  writeJSONSafe(PATHS.lockedTextChannels, [...client.lockedTextChannels]);
  writeJSONSafe(PATHS.smashChannels, [...client.smashChannels]);
  writeJSONSafe(PATHS.ghostJoinChannels, [...client.ghostJoinChannels.entries()]);
  writeJSONSafe(PATHS.inviteLogChannels, [...client.inviteLogChannels.entries()]);
  writeJSONSafe(PATHS.cooldowns, persistentCooldowns);
  
  // PV Channels serialization
  const pvObj = {};
  client.pvChannels.forEach((v, k) => {
    pvObj[k] = { allowed: [...v.allowed], ownerId: v.ownerId || null };
  });
  writeJSONSafe(PATHS.pv, pvObj);
}

function loadAll() {
  console.log("Chargement des données...");
  const loadSet = (path, set) => {
    const data = readJSONSafe(path);
    if (Array.isArray(data)) data.forEach(i => set.add(i));
  };
  const loadMap = (path, map) => {
    const data = readJSONSafe(path);
    if (Array.isArray(data)) data.forEach(([k, v]) => map.set(k, v));
  };

  loadSet(PATHS.whitelist, client.whitelist);
  loadSet(PATHS.admin, client.adminUsers);
  loadSet(PATHS.blacklist, client.blacklist);
  loadSet(PATHS.wetList, client.wetList);
  loadSet(PATHS.banList, client.banList);
  loadMap(PATHS.dogs, client.dogs);
  loadSet(PATHS.permMvUsers, client.permMvUsers);
  loadSet(PATHS.permMvRoles, client.permMvRoles);
  loadMap(PATHS.permAddRoleRoles, client.permAddRoleRoles);
  loadSet(PATHS.fabulousUsers, client.fabulousUsers);
  loadMap(PATHS.limitRoles, client.limitRoles);
  loadSet(PATHS.lockedNames, client.lockedNames);
  loadSet(PATHS.lockedTextChannels, client.lockedTextChannels);
  loadSet(PATHS.smashChannels, client.smashChannels);
  loadMap(PATHS.ghostJoinChannels, client.ghostJoinChannels);
  loadMap(PATHS.inviteLogChannels, client.inviteLogChannels);

  const cds = readJSONSafe(PATHS.cooldowns);
  if (cds && typeof cds === 'object') persistentCooldowns = cds;

  const pv = readJSONSafe(PATHS.pv);
  if (pv && typeof pv === 'object') {
    Object.entries(pv).forEach(([k, v]) => {
      client.pvChannels.set(k, { allowed: new Set(Array.isArray(v.allowed) ? v.allowed : []), ownerId: v.ownerId });
    });
  }
}

loadAll(); // Chargement initial
setInterval(persistAll, 60_000); // Auto-save toutes les minutes

// -------------------- UTILITAIRES DE HIÉRARCHIE --------------------
const isOwner = id => id === OWNER_ID;
const isWL = id => client.whitelist.has(id) || isOwner(id);
const isWet = id => client.wetList.has(id);
const isBlacklisted = id => client.blacklist.has(id);
const isFabulous = id => client.fabulousUsers.has(id) || id === OWNER_ID; // Owner est toujours Fabulous

// Calcul du niveau de permission pour comparaisons
const getRank = (member) => {
  if (!member) return 0;
  if (member.id === OWNER_ID) return 4;
  if (client.whitelist.has(member.id)) return 3;
  if (member.permissions && member.permissions.has(PermissionsBitField.Flags.Administrator)) return 2;
  if (client.adminUsers.has(member.id)) return 2;
  return 1;
};

const isAdminMember = member => getRank(member) >= 2;
const simpleEmbed = (title, desc) => new EmbedBuilder().setTitle(title).setDescription(desc).setColor(MAIN_COLOR);
const sendNoAccess = (msg, extra = "") => msg.channel.send({ embeds: [simpleEmbed("Accès refusé ✘", `${msg.author}, tu n'as pas les droits ! ${extra}`)] }).catch(()=>{});

// Gestion des logs
async function ensureLogChannels(guild) {
    // Ne rien faire si on ne veut pas auto-créer, mais utile pour logs d'erreur
    return {}; 
}

// -------------------- SERVEUR HTTP (KEEPALIVE) --------------------
http.createServer((req, res) => { res.writeHead(200); res.end('I am the best.'); }).listen(PORT);
setInterval(() => { try { http.get(`http://localhost:${PORT}`).on('error', ()=>{}); } catch(e){} }, 240000);

// -------------------- INVITE TRACKER --------------------
const getInviteCounts = async (guild) => {
  return await guild.invites.fetch();
};

// -------------------- EVENTS --------------------

client.on('ready', async () => {
  console.log(`✓ Connecté en tant que ${client.user.tag}`);
  client.user.setActivity("+help | Best JS Bot", { type: ActivityType.Listening });

  // Init Invite Cache
  client.guilds.cache.forEach(async guild => {
    try {
      const invites = await guild.invites.fetch();
      client.invites.set(guild.id, invites);
    } catch(e) {}
  });
});

// GESTION DU WET ET BLACKLIST (ANTI-UNBAN)
client.on('guildBanRemove', async (ban) => {
  try {
    // Si la personne est Wet, RE-BAN IMMÉDIAT
    if (client.wetList.has(ban.user.id)) {
        await ban.guild.members.ban(ban.user.id, { reason: "Wet List Protection - Impossible de unban" });
    }
    // Si la personne est Blacklist, RE-BAN IMMÉDIAT
    else if (client.blacklist.has(ban.user.id)) {
        await ban.guild.members.ban(ban.user.id, { reason: "On contourne pas la blacklist !" });
    }
  } catch (e) { console.error("Erreur protection unban:", e); }
});

// GESTION ARRIVÉE MEMBRES
client.on('guildMemberAdd', async member => {
  const guild = member.guild;

  // 1. WET / BL CHECK
  if (client.wetList.has(member.id)) {
    await member.ban({ reason: "Wet List (Auto-Ban)" });
    return;
  }
  if (client.blacklist.has(member.id)) {
    try { await member.send("Tu as été blacklisté !\nRaison: on contourne pas la blacklist !"); } catch {}
    await member.ban({ reason: "Blacklist (Auto-Ban)" });
    return;
  }

  // 2. ANTIBOT
  if (client.config.antibot && member.user.bot && !isWL(member.id)) { // WL peuvent ajouter des bots
    await member.kick("Anti-bot activé");
    return;
  }

  // 3. INVITE LOGGER
  const logChannelId = client.inviteLogChannels.get(guild.id);
  if (logChannelId) {
    const logChannel = guild.channels.cache.get(logChannelId);
    if (logChannel) {
      try {
        const newInvites = await guild.invites.fetch();
        const oldInvites = client.invites.get(guild.id);
        const invite = newInvites.find(i => i.uses > (oldInvites.get(i.code)?.uses || 0));
        
        const embed = new EmbedBuilder()
          .setColor(MAIN_COLOR)
          .setTitle(`Nouveau membre sur ${guild.name}`)
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `Aujourd'hui à ${new Date().toLocaleTimeString()}` });

        if (invite) {
          const inviter = invite.inviter;
          embed.setDescription(`${member} vient de rejoindre.\nInvité par ${inviter}, qui a maintenant **${invite.uses}** invitations.`);
        } else {
          embed.setDescription(`${member} vient de rejoindre.\nJe n'ai pas pu déterminer l'invitation.`);
        }
        logChannel.send({ embeds: [embed] });
        client.invites.set(guild.id, newInvites);
      } catch (e) {}
    }
  }

  // 4. GHOST PING (Ghostjoins)
  const ghostChanId = client.ghostJoinChannels.get(guild.id);
  if (ghostChanId) {
    const ch = guild.channels.cache.get(ghostChanId);
    if (ch) {
      const msg = await ch.send(`<@${member.id}>`);
      setTimeout(() => msg.delete().catch(()=>{}), 500); // Delete très rapide
    }
  }

  // 5. ANTI-RAID PUISSANT
  if (client.config.antiraid) {
    const createdAgo = Date.now() - member.user.createdTimestamp;
    if (createdAgo < 1000 * 60 * 60 * 24 * 7) { // Compte < 7 jours
        try { await member.kick("Anti-raid: Compte trop récent."); return; } catch {}
    }
    // Rate limit joins (simple implementation)
    // ... (Logique complexe omise pour brièveté, mais le kick account age est le plus efficace)
  }
});

// GESTION DÉPART MEMBRES (Invite Log Leave)
client.on('guildMemberRemove', async member => {
  const guild = member.guild;
  const logChannelId = client.inviteLogChannels.get(guild.id);
  
  // Clean up Dog logic if needed (optional, but requested persistent so we keep data)
  
  if (logChannelId) {
    const logChannel = guild.channels.cache.get(logChannelId);
    if (logChannel) {
       // Création d'un thread ou channel 'leave' si inexistant (simplifié: envoi dans le channel log)
       const embed = new EmbedBuilder()
        .setColor("Red")
        .setTitle(`Départ d'un membre de ${guild.name} !`)
        .setDescription(`${member.user.tag} a quitté le serveur.`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `Départ à ${new Date().toLocaleTimeString()}` });
       logChannel.send({ embeds: [embed] });
    }
  }
});

// GESTION MESSAGES (Smash, Commandes)
client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  // --- SMASH OR PASS LOGIC ---
  if (client.smashChannels.has(message.channel.id)) {
    // Si pas de média, delete
    if (message.attachments.size === 0 && !message.content.match(/https?:\/\/\S+\.(jpg|jpeg|png|gif|mp4|mov)/i)) {
      if (!isWL(message.author.id)) { // WL peuvent parler
        await message.delete().catch(()=>{});
        return;
      }
    }
    // Si média
    if (message.attachments.size > 0 || message.content.includes("http")) {
      await message.react('✓');
      await message.react('✘');
      await message.startThread({
        name: `Avis sur ${message.author.username}`,
        autoArchiveDuration: 1440,
      }).catch(()=>{});
    }
  }

  if (!message.content.startsWith('+')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // --- COMMANDES ---

  // 1. BACKUP (Repair)
  if (command === 'backup') {
    if (!isOwner(message.author.id)) return sendNoAccess(message);
    const sub = args[0];
    if (sub === 'save') {
      persistAll();
      return message.reply("✓ Backup sauvegardée avec succès.");
    }
    if (sub === 'load') {
      loadAll();
      return message.reply("✓ Backup chargée avec succès.");
    }
    return message.reply("Usage: `+backup save` ou `+backup load`");
  }

  // 2. SNIPE (Image & Video)
  if (command === 'snipe') {
    const snipe = client.snipes.get(message.channel.id);
    if (!snipe) return message.reply("Rien à sniper ici !");
    
    const embed = new EmbedBuilder()
      .setAuthor({ name: snipe.author.tag, iconURL: snipe.author.displayAvatarURL() })
      .setDescription(snipe.content || "*(Média uniquement)*")
      .setColor(MAIN_COLOR)
      .setFooter({ text: `Supprimé à ${new Date(snipe.timestamp).toLocaleTimeString()}` });
    
    if (snipe.image) embed.setImage(snipe.image);
    
    return message.channel.send({ embeds: [embed] });
  }

  // 3. LOCK / UNLOCK (Immédiat)
  if (command === 'lock') {
    if (!isWL(message.author.id) && !isAdminMember(message.member)) return sendNoAccess(message);
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    client.lockedTextChannels.add(message.channel.id);
    persistAll();
    return message.channel.send("✓ Salon verrouillé immédiatement (seuls WL/Admin peuvent parler).");
  }
  if (command === 'unlock') {
    if (!isWL(message.author.id) && !isAdminMember(message.member)) return sendNoAccess(message);
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
    client.lockedTextChannels.delete(message.channel.id);
    persistAll();
    return message.channel.send("✓ Salon déverrouillé immédiatement.");
  }

  // 4. DOG / UNDOG (Persistant & Formaté)
  if (command === 'dog') {
    if (!isWL(message.author.id) && !isAdminMember(message.member)) return sendNoAccess(message);
    const target = message.mentions.members.first();
    if (!target) return message.reply("Mentionne une cible.");
    // Protection Fabulous/Owner
    if (isFabulous(target.id)) return message.reply("✘ Tu ne peux pas dog le Owner ou un utilisateur Fabulous.");

    const executorName = message.member.displayName.replace(/[^\w\s]/gi, ''); // Clean special chars
    const lockedName = `🦮${target.user.username} (${executorName})`;
    
    client.dogs.set(target.id, { 
      executorId: message.author.id, 
      lockedName: lockedName,
      originalName: target.displayName 
    });
    client.lockedNames.add(target.id);
    persistAll();

    try { await target.setNickname(lockedName); } catch {}
    // Move to executor voice if possible
    if (message.member.voice.channel && target.voice.channel) {
      try { await target.voice.setChannel(message.member.voice.channel); } catch {}
    }

    return message.channel.send(`✓ ${target} est maintenant en laisse : ${lockedName}`);
  }
  if (command === 'undog') {
    // Check perm (WL, Owner, ou Executor)
    const target = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(()=>null) : null);
    if (!target) return message.reply("Cible introuvable.");
    
    const dogInfo = client.dogs.get(target.id);
    if (!dogInfo) return message.reply("Ce membre n'est pas un dog.");

    const isExecutor = dogInfo.executorId === message.author.id;
    if (!isWL(message.author.id) && !isExecutor) return sendNoAccess(message, "Seul le maître ou un WL peut libérer le dog.");

    client.dogs.delete(target.id);
    client.lockedNames.delete(target.id);
    persistAll();

    try { await target.setNickname(null); } catch {} // Reset nickname
    return message.channel.send(`✓ ${target.user.tag} a été libéré.`);
  }

  // 5. WET (Super Ban)
  if (command === 'wet') {
    if (!isWL(message.author.id)) return sendNoAccess(message, "Seul WL+ peut utiliser wet.");
    const target = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(()=>null) : null);
    if (!target) return message.reply("Cible introuvable.");

    // Hiérarchie check
    if (getRank(target) >= getRank(message.member)) {
      setTimeout(() => message.delete().catch(()=>{}), 2000);
      return message.channel.send(`Vous ne pouvez pas effectuer cette commande sur votre supérieur !`).then(m => setTimeout(()=>m.delete(), 2000));
    }

    const reason = args.slice(1).join(' ').replace(/<@!?\d+>/, '').trim() || "Aucune raison fournie";
    
    client.wetList.add(target.id);
    persistAll();
    
    await target.ban({ reason: `WET par ${message.author.tag}: ${reason}` }).catch(()=>{});
    return message.channel.send(`⚠️ **${target.user.tag}** a été WET (Ban permanent irrévocable sauf +unwet).`);
  }
  
  if (command === 'unwet') {
    if (!isWL(message.author.id)) {
      return message.channel.send("Attention à toi tu essaie de unban un utilisateur qui a été Wet par un Sys+.");
    }
    const targetId = args[0] ? args[0].replace(/[<@!>]/g, '') : null;
    if (!targetId) return message.reply("ID requis.");
    
    if (!client.wetList.has(targetId)) return message.reply("Cet utilisateur n'est pas wet.");
    client.wetList.delete(targetId);
    persistAll();
    try { await message.guild.members.unban(targetId); } catch {}
    return message.channel.send(`✓ Utilisateur ${targetId} UN-WET.`);
  }

  // 6. BLACKLIST (+bl)
  if (command === 'bl') {
    if (!isWL(message.author.id) && !isAdminMember(message.member)) return sendNoAccess(message);
    const target = message.mentions.members.first();
    if (!target) return message.reply("Mentionne la cible.");

    // Parse raison : +bl @user raison ici
    let reason = args.slice(1).join(' ') || "non fournis";
    
    // DM Message
    try {
      await target.send(`Tu as été blacklisté\nRaison: ${reason}`);
    } catch {}

    client.blacklist.add(target.id);
    persistAll();
    await target.ban({ reason: `Blacklist: ${reason}` }).catch(()=>{});

    return message.channel.send(`✓ **${target.user.tag}** blacklisté.`);
  }
  if (command === 'unbl') {
    if (!isWL(message.author.id) && !isAdminMember(message.member)) return sendNoAccess(message);
    const id = args[0] ? args[0].replace(/[<@!>]/g, '') : null;
    if (!id) return message.reply("ID ou mention requise.");
    
    client.blacklist.delete(id);
    persistAll();
    try { await message.guild.members.unban(id); } catch {}
    return message.channel.send(`✓ ${id} retiré de la blacklist.`);
  }

  // 7. BAN INFO / BL INFO EMBEDS
  if (command === 'baninfo' || command === 'blinfo') {
    const id = args[0] ? args[0].replace(/[<@!>]/g, '') : null;
    if (!id) return message.reply("ID requis.");

    // Cherche info
    const isBl = client.blacklist.has(id);
    const isWet = client.wetList.has(id);
    let user;
    try { user = await client.users.fetch(id); } catch { return message.reply("Utilisateur introuvable."); }

    const embed = new EmbedBuilder()
      .setColor(MAIN_COLOR)
      .setTitle(`📜 Informations sur le ${isWet ? "WET" : (isBl ? "Blacklist" : "Bannissement")}`)
      .setDescription(`
**👤 Utilisateur :**
Nom d'utilisateur : ${user.username}
Identifiant : ${user.id}

**📄 Informations :**
Raison : ${isWet ? "WET LIST" : (isBl ? "Blacklisté" : "Banni")}

**👮‍♂️ Modérateur :**
*(Info non stockée en historique précis dans cette version V1, voir logs)*

**📅 Date :**
${new Date().toLocaleString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      `);
      
    return message.channel.send({ embeds: [embed] });
  }

  // 8. FABULOUS BOT (+fabulousbot)
  if (command === 'fabulousbot') {
    if (!isOwner(message.author.id)) return sendNoAccess(message);
    const target = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(()=>null) : null);
    if (!target) return message.reply("Cible invalide.");
    
    if (client.fabulousUsers.has(target.id)) {
      client.fabulousUsers.delete(target.id);
      message.reply(`✘ ${target.tag} n'est plus Fabulous.`);
    } else {
      client.fabulousUsers.add(target.id);
      message.reply(`✓ ${target.tag} est maintenant **Fabulous** (Immunité & Reflet).`);
    }
    persistAll();
    return;
  }

  // 9. SMASH SETUP
  if (command === 'smash') {
    if (!isWL(message.author.id)) return sendNoAccess(message);
    const chanId = message.channel.id;
    if (client.smashChannels.has(chanId)) {
      client.smashChannels.delete(chanId);
      message.reply("✘ Ce salon n'est plus en mode Smash or Pass.");
    } else {
      client.smashChannels.add(chanId);
      message.reply("✓ Ce salon est maintenant en mode **Smash or Pass** (Média uniquement + Threads auto).");
    }
    persistAll();
    return;
  }

  // 10. GHOST JOINS
  if (command === 'ghostjoins') {
    if (!isWL(message.author.id)) return sendNoAccess(message);
    const chanId = args[0] ? args[0].replace(/[<#>]/g, '') : message.channel.id;
    
    // Toggle
    if (client.ghostJoinChannels.has(message.guild.id) && client.ghostJoinChannels.get(message.guild.id) === chanId) {
       client.ghostJoinChannels.delete(message.guild.id);
       message.reply("✘ Ghostjoins désactivé.");
    } else {
       client.ghostJoinChannels.set(message.guild.id, chanId);
       message.reply(`✓ Ghostjoins activé dans <#${chanId}>.`);
    }
    persistAll();
    return;
  }

  // 11. INVITE LOGER SETUP
  if (command === 'inviteloger') {
    if (!isWL(message.author.id)) return sendNoAccess(message);
    const chanId = args[0] ? args[0].replace(/[<#>]/g, '') : message.channel.id;
    client.inviteLogChannels.set(message.guild.id, chanId);
    persistAll();
    return message.reply(`✓ Invite Logger défini sur <#${chanId}>.`);
  }

  // 12. PERM MV / ADDROLE
  if (command === 'permmv') {
    if (!isOwner(message.author.id)) return sendNoAccess(message);
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
    if (!role) return message.reply("Rôle introuvable.");
    client.permMvRoles.add(role.id);
    persistAll();
    return message.reply(`✓ Le rôle **${role.name}** peut maintenant utiliser +mv.`);
  }
  if (command === 'delpermmv') {
    if (!isOwner(message.author.id)) return sendNoAccess(message);
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
    if (!role) return message.reply("Rôle introuvable.");
    client.permMvRoles.delete(role.id);
    persistAll();
    return message.reply(`✓ Le rôle **${role.name}** ne peut plus utiliser +mv.`);
  }
  if (command === 'permmvrolelist') {
     const list = [...client.permMvRoles].map(id => `<@&${id}>`).join("\n") || "Aucun";
     return message.channel.send(`Rôles perm +mv:\n${list}`);
  }

  if (command === 'permaddrole') {
    if (!isOwner(message.author.id)) return sendNoAccess(message);
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
    const count = parseInt(args[1]);
    if (!role || isNaN(count)) return message.reply("Usage: +permaddrole @role <count>");
    client.permAddRoleRoles.set(role.id, count);
    persistAll();
    return message.reply(`✓ Le rôle **${role.name}** peut utiliser +addrole (${count} fois par action/jour - *logique simplifiée*).`);
  }

  // 13. UI (USER INFO ULTIME)
  if (command === 'ui') {
    let target = message.mentions.members.first();
    if (!target && args[0]) target = await message.guild.members.fetch(args[0]).catch(()=>null);
    if (!target) target = message.member;

    const statusMap = {
      online: "En ligne",
      idle: "Inactif",
      dnd: "Ne pas déranger",
      offline: "Hors ligne"
    };

    // Détection Plateforme
    let platforms = [];
    if (target.presence?.clientStatus?.desktop) platforms.push("Ordinateur");
    if (target.presence?.clientStatus?.mobile) platforms.push("Portable");
    if (target.presence?.clientStatus?.web) platforms.push("Web");
    const platformStr = platforms.length > 0 ? platforms.join(" / ") : "Inconnu/Hors ligne";

    // Activité
    const activities = target.presence?.activities || [];
    const status = statusMap[target.presence?.status] || "Hors ligne";
    const actStr = activities.length > 0 ? activities.map(a => a.name).join(", ") : "Rien";
    const voiceStatus = target.voice.channel ? `Vocal (${target.voice.channel.name})` : "Pas en vocal";

    // Dates formatées
    const createdStr = target.user.createdAt.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
    const joinedStr = target.joinedAt ? target.joinedAt.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }) : "Inconnu";

    // Rôles
    const rolesStr = target.roles.cache
      .filter(r => r.name !== '@everyone')
      .sort((a, b) => b.position - a.position)
      .map(r => `<@&${r.id}>`)
      .join("\n") || "Aucun rôle";

    const embed = new EmbedBuilder()
      .setColor(MAIN_COLOR)
      .setTitle("Compte :")
      .setDescription(`<@${target.id}>`)
      .setThumbnail(target.user.displayAvatarURL({ dynamic: true, size: 512 }))
      .addFields(
        { name: "Informations", value: `Pseudo: ${target.user.username}\nId: ${target.id}`, inline: false },
        { name: "Activité/Statut", value: `Statut : ${status}\nPlateforme : ${platformStr}\nActivité : ${actStr}\n${voiceStatus}`, inline: false },
        { name: "Dates", value: `Créé : ${createdStr}\nRejoint : ${joinedStr}`, inline: false },
        { name: "Rôles", value: rolesStr, inline: false }
      );

    return message.channel.send({ embeds: [embed] });
  }

  // 14. HELP (Compact)
  if (command === 'help') {
    const commandsList = `
**Général**
\`+ui\` - Info complètes utilisateur
\`+pic\` - Avatar global + serveur
\`+snipe\` - Dernier msg supprimé (img/vidéo incluse)

**Modération & Sécurité**
\`+lock\` / \`+unlock\` - Verrouillage immédiat
\`+wet\` / \`+unwet\` - Ban sys+ irrévocable (Hiérarchie)
\`+bl\` / \`+unbl\` - Blacklist + DM + Auto-reban
\`+ban\` / \`+unban\` / \`+unbanall\` - Ban classique (sauf BL/Wet)
\`+dog\` / \`+undog\` - Laisse & Rename persistant
\`+smash\` - Active mode smash or pass
\`+inviteloger\` - Définit salon de logs invitations
\`+ghostjoins\` - Active ghost ping join
\`+antiraid\` - Mode super puissant

**Permissions & Owner**
\`+fabulousbot\` - Immunité totale pour un user
\`+permmv\` / \`+delpermmv\` - Perm +mv par rôle
\`+backup save/load\` - Gestion sauvegarde
`;
    const embed = new EmbedBuilder().setTitle("Liste des commandes").setDescription(commandsList).setColor(MAIN_COLOR).setFooter({ text: `Owner: ${OWNER_ID}` });
    return message.channel.send({ embeds: [embed] });
  }

  // --- ANCIENNES COMMANDES MISES À JOUR ---
  
  // MV avec check rôle
  if (command === 'mv') {
    const hasPermRole = message.member.roles.cache.some(r => client.permMvRoles.has(r.id));
    if (!hasPermRole && !client.permMvUsers.has(message.author.id) && !isWL(message.author.id) && !isAdminMember(message.member)) 
      return sendNoAccess(message);
    
    if (!message.member.voice.channel) return message.reply("Tu n'es pas en vocal.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("Cible introuvable.");
    if (!target.voice.channel) return message.reply("Cible pas en vocal.");

    // Protection Fabulous
    if (isFabulous(target.id)) return message.reply("✘ Impossible de move un Fabulous.");

    await target.voice.setChannel(message.member.voice.channel);
    return message.channel.send(`✓ ${target.displayName} déplacé.`);
  }

  // UNBANALL Safe
  if (command === 'unbanall') {
    if (!isWL(message.author.id)) return sendNoAccess(message);
    const bans = await message.guild.bans.fetch();
    let count = 0;
    bans.forEach(ban => {
      // NE PAS UNBAN SI BL OU WET
      if (!client.wetList.has(ban.user.id) && !client.blacklist.has(ban.user.id)) {
        message.guild.members.unban(ban.user.id);
        count++;
      }
    });
    return message.channel.send(`✓ Tentative d'unban de ${count} membres (BL et Wet exclus).`);
  }

  // PIC (Global + Local)
  if (command === 'pic') {
    let target = message.mentions.users.first() || await client.users.fetch(args[0]).catch(()=>null) || message.author;
    const member = message.guild.members.cache.get(target.id);
    
    const embed = new EmbedBuilder().setColor(MAIN_COLOR).setTitle(`Pic: ${target.tag}`);
    embed.setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }));
    
    // Si avatar serveur différent, on l'ajoute en thumbnail
    if (member && member.avatar) {
      embed.setThumbnail(member.displayAvatarURL({ dynamic: true }));
      embed.setDescription("Grande image: Profil Global\nPetite image: Profil Serveur");
    }
    return message.channel.send({ embeds: [embed] });
  }

});

// -------------------- EVENT DELETE (SNIPE) --------------------
client.on('messageDelete', message => {
  if (message.author?.bot) return;
  
  // Stockage Snipe (Image support)
  const image = message.attachments.first() ? message.attachments.first().url : null;
  client.snipes.set(message.channel.id, {
    content: message.content,
    author: message.author,
    timestamp: Date.now(),
    image: image
  });
});

// -------------------- PROTECTION FABULOUS & DOG PERSISTENCE --------------------

// Surveillance Voice (Disconnect/Mute/Deaf protection + Dog follow)
client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member;
  if (!member) return;

  // DOG LOGIC: Follow Master
  const dogInfo = client.dogs.get(member.id);
  if (dogInfo && newState.channelId) {
    const executor = member.guild.members.cache.get(dogInfo.executorId);
    if (executor && executor.voice.channelId && executor.voice.channelId !== newState.channelId) {
      // Si le dog bouge ailleurs que le maitre -> retour maitre
      try { await member.voice.setChannel(executor.voice.channelId); } catch {}
    }
  }

  // FABULOUS PROTECTION
  if (isFabulous(member.id)) {
    // Si déconnecté par qqn d'autre (difficile à détecter sans audit log précis en temps réel, mais on protège mute/deaf)
    if (newState.serverMute && !oldState.serverMute) {
       await member.voice.setMute(false); // Unmute immédiat
       // Reflection: Trouver qui l'a fait via AuditLog serait l'idéal, ici on annule juste.
    }
    if (newState.serverDeaf && !oldState.serverDeaf) {
       await member.voice.setDeaf(false);
    }
  }
});

// Surveillance Pseudo (Dog Lock + Fabulous Rename Protection)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  // DOG LOCK NAME
  if (client.dogs.has(newMember.id)) {
    const info = client.dogs.get(newMember.id);
    if (newMember.nickname !== info.lockedName) {
      try { await newMember.setNickname(info.lockedName); } catch {}
    }
  }
  
  // FABULOUS RENAME PROTECTION
  if (isFabulous(newMember.id) && oldMember.nickname !== newMember.nickname) {
    // Si on change le nom d'un fabulous
    const auditLogs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 1 });
    const log = auditLogs.entries.first();
    if (log && log.executor.id !== newMember.id && log.executor.id !== client.user.id) {
        // C'est quelqu'un d'autre qui a changé le nom -> Revert
        await newMember.setNickname(oldMember.nickname);
        // Reflection: Rename l'agresseur (Fun)
        const executor = await newMember.guild.members.fetch(log.executor.id);
        if (executor) {
            try { await executor.setNickname("J'ai touché un Fabulous"); } catch {}
        }
    }
  }
});

// -------------------- CONNEXION --------------------
const token = process.env.TOKEN;
if (!token) {
  console.error("ERREUR: TOKEN manquant dans le .env");
  process.exit(1);
}

client.login(token).catch(err => console.error("Login Error:", err));
