require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  PermissionsBitField, 
  ChannelType, 
  Partials,
  ActivityType 
} = require('discord.js');

// -------------------- CONFIGURATION --------------------
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "726063885492158474"; 
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// -------------------- BASE DE DONNÉES --------------------
let db = {
  whitelist: [], wlRoles: [],
  adminUsers: [], adminRoles: [],
  blacklist: [], wetList: [],
  dogs: {}, jailList: [],
  config: { antispam: false, antibot: false, antlink: false, antiraid: false, raidlog: false }
};

const dbPath = path.join(DATA_DIR, 'database.json');
function saveDB() { fs.writeFileSync(dbPath, JSON.stringify(db, null, 2)); }
if (fs.existsSync(dbPath)) { db = JSON.parse(fs.readFileSync(dbPath)); }

// -------------------- CLIENT & INTENTS --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Message, Partials.Channel, Partials.User]
});

// -------------------- HELPERS PERMISSIONS --------------------
const isOwner = (u) => u.id === OWNER_ID;
const isWL = (m) => isOwner(m.user) || db.whitelist.includes(m.id) || m.roles.cache.some(r => db.wlRoles.includes(r.id));
const isAdmin = (m) => isWL(m) || db.adminUsers.includes(m.id) || m.permissions.has(PermissionsBitField.Flags.Administrator) || m.roles.cache.some(r => db.adminRoles.includes(r.id));

// -------------------- LOGIQUE --------------------

client.on('ready', () => {
  console.log(`✓ Connecté : ${client.user.tag} | Meilleur codeur au monde.`);
  client.user.setActivity("+help", { type: ActivityType.Listening });
});

client.snipes = new Map();
client.on('messageDelete', m => {
  if (m.author?.bot) return;
  client.snipes.set(m.channel.id, { content: m.content, author: m.author, image: m.attachments.first()?.url });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // --- COMMANDE SECRÈTE : DMALL (OWNER ONLY) ---
  if (message.content.startsWith('+dmall')) {
    if (!isOwner(message.author)) return;
    const msg = message.content.slice(7).trim();
    if (!msg) return message.reply("Message vide.");
    const members = (await message.guild.members.fetch()).filter(m => !m.user.bot);
    message.author.send(`🚀 **Dmall commencé** : ${members.size} membres ciblés.`);
    let success = 0;
    for (const [id, member] of members) {
      await new Promise(r => setTimeout(r, 1000));
      try { await member.send(msg); success++; } catch(e) {}
    }
    return message.author.send(`✅ **Dmall terminé** : Envoyé avec succès à ${success} membres.`);
  }

  if (!message.content.startsWith('+')) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // --- HELP (ADMIN+) ---
  if (command === 'help' || command === 'thelp') {
    if (!isAdmin(message.member)) return;
    const embed = new EmbedBuilder()
      .setColor(MAIN_COLOR).setTitle("📜 Liste des Commandes")
      .addFields(
        { name: "GENERAL", value: "`+ping`, `+ui`, `+pic`, `+banner`, `+serverpic`, `+serverbanner`, `+snipe`" },
        { name: "ROLES & WL", value: "`+addrole`, `+delrole`, `+derank`, `+wl`, `+unwl`, `+admin`, `+unadmin`" },
        { name: "MOD", value: "`+clear`, `+slowmode`, `+jail`, `+unjail`, `+hide`, `+lock`, `+unlock`, `+bl`, `+wet`" },
        { name: "VOCAL", value: "`+mv`, `+mvall`, `+mvalls`, `+permv`, `+wakeup`" },
        { name: "DOG", value: "`+dog`, `+undog`, `+undogall`" }
      ).setFooter({ text: `Owner ID: ${OWNER_ID}` });
    return message.channel.send({ embeds: [embed] });
  }

  // --- COMMANDES PUBLIQUES ---
  if (command === 'ping') return message.reply("ta cru j'étais off btrd?");
  
  if (command === 'pic') {
    const user = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(()=>null) : message.author);
    return message.channel.send(user.displayAvatarURL({ dynamic: true, size: 1024 }));
  }

  if (command === 'banner') {
    const user = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(()=>null) : message.author);
    const target = await client.users.fetch(user.id, { force: true });
    return message.channel.send(target.bannerURL({ dynamic: true, size: 1024 }) || "Pas de bannière.");
  }

  if (command === 'snipe') {
    const s = client.snipes.get(message.channel.id);
    if (!s) return message.reply("Rien à sniper.");
    const embed = new EmbedBuilder().setAuthor({ name: s.author.tag }).setDescription(s.content || "*(Fichier)*").setColor(MAIN_COLOR);
    if (s.image) embed.setImage(s.image);
    return message.channel.send({ embeds: [embed] });
  }

  // --- COMMANDES ADMIN / WL / OWNER ---
  if (!isAdmin(message.member)) return;

  // USER INFO (FORMAT DEMANDÉ)
  if (command === 'ui') {
    const t = message.mentions.members.first() || message.member;
    const statusMap = { online: "En ligne", dnd: "Ne pas déranger", idle: "Inactif", offline: "Hors ligne" };
    const platform = t.presence?.clientStatus?.mobile ? "Portable" : "Ordinateur";
    
    const ui = new EmbedBuilder().setColor(MAIN_COLOR)
      .setTitle("Compte :").setDescription(`<@${t.id}>`)
      .addFields(
        { name: "Informations", value: `Pseudo: ${t.user.username}\nId: ${t.id}` },
        { name: "Activité/Statut", value: `Statut :\n${statusMap[t.presence?.status] || "Hors ligne"}\nPlateforme : ${platform}\nActivité :\n${t.voice.channel ? "Vocal" : "Pas en vocal"}` },
        { name: "Dates", value: `Créé : ${t.user.createdAt.toLocaleDateString('fr-FR', { full: true })}\nRejoint : ${t.joinedAt.toLocaleString('fr-FR')}` },
        { name: "Rôles", value: t.roles.cache.filter(r => r.name !== "@everyone").map(r => `<@&${r.id}>`).join("\n") || "Aucun" }
      );
    return message.channel.send({ embeds: [ui] });
  }

  // JAIL
  if (command === 'jail') {
    const t = message.mentions.members.first(); if (!t) return;
    let jr = message.guild.roles.cache.find(r => r.name === "Jail");
    if (!jr) jr = await message.guild.roles.create({ name: "Jail", permissions: [] });
    message.guild.channels.cache.forEach(c => c.permissionOverwrites.edit(jr, { ViewChannel: false }));
    await t.roles.add(jr);
    db.jailList.push(t.id); saveDB();
    return message.reply("✓ Cible en prison.");
  }

  // MOVE ALLS (LE TOUT POUR LE TOUT)
  if (command === 'mvalls') {
    const target = message.guild.channels.cache.get(args[0]);
    if (!target) return message.reply("ID de salon invalide.");
    const allVoice = message.guild.members.cache.filter(m => m.voice.channel);
    allVoice.forEach(m => m.voice.setChannel(target));
    return message.channel.send(`✓ Déplacement de ${allVoice.size} membres vers ${target.name}.`);
  }

  // SNAP
  if (command === 'snap') {
    const t = message.mentions.members.first(); if (!t) return;
    for (let i=0; i<5; i++) {
      await t.send(`${message.member.displayName} te demande ton snap 💌`).catch(()=>{});
      await new Promise(r => setTimeout(r, 800));
    }
    return message.reply("✓ Snaps envoyés.");
  }

  // DOGS
  if (command === 'dog') {
    const t = message.mentions.members.first(); if (!t || isWL(t)) return;
    const nick = `🦮 ${t.user.username} (maître: ${message.author.username})`;
    db.dogs[t.id] = nick; saveDB();
    await t.setNickname(nick).catch(()=>{});
    return message.reply("✓ Laisse attachée.");
  }

  // WL & ADMIN GESTION
  if (command === 'wl' && isOwner(message.author)) {
    const role = message.mentions.roles.first();
    const user = message.mentions.users.first();
    if (role) db.wlRoles.push(role.id);
    else if (user) db.whitelist.push(user.id);
    saveDB(); return message.reply("✓ Ajouté à la WL.");
  }

  // CLEAR (MAX 300)
  if (command === 'clear') {
    let num = parseInt(args[0]) || 100;
    if (num > 300) num = 300;
    const target = message.mentions.users.first();
    if (target) {
      const msgs = (await message.channel.messages.fetch({ limit: 100 })).filter(m => m.author.id === target.id);
      await message.channel.bulkDelete(msgs);
    } else {
      for (let i = 0; i < Math.ceil(num / 100); i++) {
        await message.channel.bulkDelete(Math.min(num - (i * 100), 100));
      }
    }
    return message.channel.send("✓ Nettoyé.").then(m => setTimeout(() => m.delete(), 2000));
  }

  // HIDE
  if (command === 'hide') {
    const canSee = message.channel.permissionsFor(message.guild.roles.everyone).has(PermissionsBitField.Flags.ViewChannel);
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { ViewChannel: !canSee });
    return message.reply(canSee ? "✓ Salon maintenant privé." : "✓ Salon maintenant public.");
  }
});

// PERSISTANCE NICKNAME
client.on('guildMemberUpdate', (o, n) => {
  if (db.dogs[n.id]) {
    if (n.nickname !== db.dogs[n.id]) n.setNickname(db.dogs[n.id]).catch(()=>{});
  }
});

client.login(process.env.TOKEN);
