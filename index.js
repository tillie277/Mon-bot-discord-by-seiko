require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { 
  Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, 
  ChannelType, Partials, ActivityType 
} = require('discord.js');

// --- SERVEUR DE MAINTIEN POUR RENDER ---
http.createServer((req, res) => {
  res.write("Inaya System Online");
  res.end();
}).listen(process.env.PORT || 3000);

// --- CONFIGURATION & BASE DE DONNÉES ---
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "726063885492158474"; 
const DATA_DIR = path.resolve(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let db = {
  whitelist: [], adminUsers: [], lockedNicks: {},
  raidConfig: { status: false, antiLink: true, antiSpam: 5, antiToken: true, antiBot: true, antiMention: 5, antiCaps: 50, antiInvite: true, maxBan: 3 }
};

const dbPath = path.join(DATA_DIR, 'database.json');
const saveDB = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

if (fs.existsSync(dbPath)) {
    try { db = JSON.parse(fs.readFileSync(dbPath)); } catch (e) { saveDB(); }
}

// --- CLIENT AVEC INTENTS COMPLETS ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // CRUCIAL pour les commandes en +
    GatewayIntentBits.GuildMembers,   // CRUCIAL pour dmall et antiraid
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences
  ],
  partials: [Partials.Message, Partials.Channel, Partials.User, Partials.GuildMember]
});

// --- INITIALISATION ---
client.on('ready', () => {
    console.log(`🚀 Inaya est prête : ${client.user.tag}`);
    client.user.setActivity('seïko votre Rois', { 
        type: ActivityType.Streaming, 
        url: 'https://www.twitch.tv/discord' 
    });
});

// --- HELPERS ---
const isOwner = (u) => u.id === OWNER_ID;
const isWL = (m) => isOwner(m.user) || db.whitelist.includes(m.id);
const isAdmin = (m) => isWL(m) || db.adminUsers.includes(m.id) || m.permissions.has(PermissionsBitField.Flags.Administrator);

async function sendLog(guild, content) {
    try {
        let category = guild.channels.cache.find(c => c.name === "inaya-logs" && c.type === ChannelType.GuildCategory);
        if (!category) category = await guild.channels.create({ name: "inaya-logs", type: ChannelType.GuildCategory });
        
        let logChan = guild.channels.cache.find(c => c.name === "commande-logs" && c.parentId === category.id);
        if (!logChan) logChan = await guild.channels.create({ name: "commande-logs", type: ChannelType.GuildText, parent: category.id });
        
        const embed = new EmbedBuilder().setColor(MAIN_COLOR).setDescription(content).setTimestamp();
        logChan.send({ embeds: [embed] });
    } catch (e) { console.log("Erreur Log:", e.message); }
}

// --- ANTI-RAID ---
client.on('guildMemberAdd', async (member) => {
    if (!db.raidConfig.status) return;
    if (db.raidConfig.antiBot && member.user.bot) return member.kick("Anti-Bot").catch(() => {});
    if (db.raidConfig.antiToken && (Date.now() - member.user.createdTimestamp) < 172800000) return member.kick("Anti-Token").catch(() => {});
});

// --- COMMANDES ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith('+')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  try {
      // OWNER
      if (command === 'dmall' && isOwner(message.author)) {
        const text = args.join(" ");
        if (!text) return message.reply("Contenu vide !");
        const members = await message.guild.members.fetch(); // Fetch forçage
        const targets = members.filter(m => !m.user.bot);
        message.reply(`Envoi en cours à ${targets.size} membres...`);
        targets.forEach(m => m.send(text).catch(() => {}));
        return sendLog(message.guild, `📢 **DMALL** par ${message.author.tag}`);
      }

      if (command === 'antiraid' && isOwner(message.author)) {
        db.raidConfig.status = !db.raidConfig.status; saveDB();
        return message.reply(`🛡️ Anti-Raid : **${db.raidConfig.status ? "ON" : "OFF"}**`);
      }

      // WHITELIST
      if (isWL(message.member)) {
        if (command === 'ban') {
          const target = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(()=>null);
          if (!target) return message.reply("Membre introuvable.");
          if (target.roles.highest.position >= message.guild.members.me.roles.highest.position) return message.reply("Je ne peux pas bannir ce membre.");
          await target.ban();
          message.reply(`${target.user.tag} a été banni.`);
        }

        if (command === 'renew') {
            const newChan = await message.channel.clone();
            await message.channel.delete();
            return newChan.send("Salon recréé avec succès. ✨");
        }

        if (command === 'mvalls') {
            const channelId = args[0];
            const channel = message.guild.channels.cache.get(channelId);
            if (!channel || channel.type !== ChannelType.GuildVoice) return message.reply("ID vocal invalide.");
            const allMembers = await message.guild.members.fetch();
            const inVoice = allMembers.filter(m => m.voice.channel);
            inVoice.forEach(m => m.voice.setChannel(channel).catch(() => {}));
            message.reply(`Déplacement de ${inVoice.size} membres.`);
        }
      }

      // ADMIN
      if (isAdmin(message.member)) {
        if (command === 'jail') {
            const target = message.mentions.members.first();
            if (!target) return message.reply("Mentionne quelqu'un.");
            let role = message.guild.roles.cache.find(r => r.name === "Jail");
            if (!role) role = await message.guild.roles.create({ name: "Jail", color: "#000000" });
            message.guild.channels.cache.forEach(c => c.permissionOverwrites.edit(role, { ViewChannel: false }).catch(()=>{}));
            await target.roles.add(role);
            message.reply(`${target.user.tag} est maintenant en cage.`);
        }
      }

      // PUBLIC
      if (command === 'ping') return message.reply("🏓 Pong! Je suis opérationnel.");

      if (command === 'help') {
        const help = new EmbedBuilder().setColor(MAIN_COLOR).setTitle("📚 Inaya - Panel de Commandes")
        .addFields(
            { name: "👑 Owner", value: "`+dmall`, `+antiraid`" },
            { name: "🛡️ Whitelist", value: "`+ban`, `+clear`, `+renew`, `+mvalls`" },
            { name: "🛠️ Admin", value: "`+mvall`, `+snap`, `+mp`, `+jail`, `+lockname`" },
            { name: "✨ Public", value: "`+ping`, `+say`" }
        );
        return message.channel.send({ embeds: [help] });
      }

  } catch (err) { console.error(err); }
});

client.login(process.env.TOKEN);
