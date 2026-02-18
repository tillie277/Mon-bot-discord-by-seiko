require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { 
  Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, 
  ChannelType, Partials, ActivityType 
} = require('discord.js');

// -------------------- CONFIGURATION --------------------
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "726063885492158474"; 
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let db = {
  whitelist: [], adminUsers: [],
  lockedNicks: {}, // ID: Nickname
  raidConfig: { status: false, antiLink: true, antiSpam: 5, antiToken: true, antiBot: true, antiMention: 5, antiCaps: 50, antiInvite: true, maxBan: 3 }
};

const dbPath = path.join(DATA_DIR, 'database.json');
const saveDB = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
if (fs.existsSync(dbPath)) db = JSON.parse(fs.readFileSync(dbPath));

const client = new Client({
  intents: Object.values(GatewayIntentBits),
  partials: [Partials.Message, Partials.Channel, Partials.User, Partials.GuildMember]
});

// -------------------- HELPERS & PERMS --------------------
const isOwner = (u) => u.id === OWNER_ID;
const isWL = (m) => isOwner(m.user) || db.whitelist.includes(m.id);
const isAdmin = (m) => isWL(m) || db.adminUsers.includes(m.id) || m.permissions.has(PermissionsBitField.Flags.Administrator);

const cooldowns = new Set();

// -------------------- SYSTÈME DE LOGS AUTOMATIQUE --------------------
async function sendLog(guild, content) {
    let category = guild.channels.cache.find(c => c.name === "inaya-logs" && c.type === ChannelType.GuildCategory);
    if (!category) {
        category = await guild.channels.create({
            name: "inaya-logs",
            type: ChannelType.GuildCategory,
            permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        });
    }
    let logChan = guild.channels.cache.find(c => c.name === "commande-logs" && c.parentId === category.id);
    if (!logChan) {
        logChan = await guild.channels.create({
            name: "commande-logs",
            type: ChannelType.GuildText,
            parent: category.id
        });
    }
    const embed = new EmbedBuilder()
        .setColor(MAIN_COLOR)
        .setDescription(content)
        .setTimestamp();
    logChan.send({ embeds: [embed] });
}

// -------------------- LOGIQUE ANTI-RAID --------------------
client.on('guildMemberAdd', async (member) => {
    if (!db.raidConfig.status) return;
    if (db.raidConfig.antiBot && member.user.bot) return member.kick("Anti-Bot");
    if (db.raidConfig.antiToken && (Date.now() - member.user.createdTimestamp) < 86400000) return member.kick("Anti-Token");
});

// -------------------- COMMANDES --------------------
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith('+')) return;

  if (cooldowns.has(message.author.id)) return;
  cooldowns.add(message.author.id);
  setTimeout(() => cooldowns.delete(message.author.id), 500);

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // --- COMMANDES OWNER ---
  if (isOwner(message.author)) {
    if (command === 'antiraid') {
        db.raidConfig.status = !db.raidConfig.status; saveDB();
        sendLog(message.guild, `🛡️ **Anti-Raid** modifié par ${message.author.tag} : ${db.raidConfig.status ? "ON" : "OFF"}`);
        return message.reply(`Anti-Raid: ${db.raidConfig.status ? "Activé" : "Désactivé"}`);
    }
    if (command === 'dmall') {
        const text = args.join(" ");
        if (!text) return message.reply("Texte manquant.");
        const members = await message.guild.members.fetch();
        members.forEach(m => { if(!m.user.bot) m.send(text).catch(()=>{}) });
        sendLog(message.guild, `🚀 **DMALL** lancé par ${message.author.tag}`);
        return message.reply("DM envoyé à tout le serveur.");
    }
  }

  // --- COMMANDES WHITELIST (WL) ---
  if (isWL(message.member)) {
    if (command === 'ban') {
        const target = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(()=>null);
        if (target) { await target.ban(); message.reply("Banni."); sendLog(message.guild, `🔨 **Ban** : ${target.user.tag} par ${message.author.tag}`); }
    }
    if (command === 'unban') {
        await message.guild.members.unban(args[0]); message.reply("Débanni.");
        sendLog(message.guild, `🔓 **Unban** : ID ${args[0]} par ${message.author.tag}`);
    }
    if (command === 'clear') {
        let amount = parseInt(args[0]) || 100;
        await message.channel.bulkDelete(amount, true);
        sendLog(message.guild, `🧹 **Clear** : ${amount} msgs dans ${message.channel.name} par ${message.author.tag}`);
    }
    if (command === 'renew') {
        const newChan = await message.channel.clone();
        await message.channel.delete();
        sendLog(newChan.guild, `🔄 **Renew** : Salon ${newChan.name} recréé par ${message.author.tag}`);
    }
    if (command === 'addrole') {
        const target = message.mentions.members.first();
        const role = message.guild.roles.cache.find(r => r.name === args.slice(1).join(" "));
        if(target && role) { await target.roles.add(role); message.reply("Rôle ajouté."); }
    }
    if (command === 'derank') {
        const target = message.mentions.members.first();
        if(target) { await target.roles.set([]); message.reply("Derank OK."); }
    }
  }

  // --- COMMANDES ADMIN / FUN MOD ---
  if (isAdmin(message.member)) {
    if (command === 'mute') {
        const target = message.mentions.members.first();
        if(target) { await target.timeout(600000); message.reply("Mute 10m."); }
    }
    if (command === 'snap') {
        const target = message.mentions.members.first();
        if(target) {
            for(let i=0; i<5; i++) { await target.send(`${message.member.displayName} te demande ton snap 💌`).catch(()=>{}); }
            message.reply("Snaps envoyés.");
            sendLog(message.guild, `📸 **Snap** : ${target.user.tag} ciblé par ${message.author.tag}`);
        }
    }
    if (command === 'mp') {
        const target = message.mentions.members.first();
        const msg = args.slice(1).join(" ");
        if(target && msg) {
            await target.send(`${message.member.displayName} t'envoie : ${msg}`).catch(()=>{});
            message.reply("MP envoyé.");
            sendLog(message.guild, `📩 **MP** envoyé à ${target.user.tag} par ${message.author.tag}`);
        }
    }
    if (command === 'lockname') {
        const target = message.mentions.members.first();
        if(target) { db.lockedNicks[target.id] = target.displayName; saveDB(); message.reply("Pseudo verrouillé."); }
    }
    if (command === 'say') { message.delete(); message.channel.send(args.join(" ")); }
  }

  // --- HELP ---
  if (command === 'help') {
      const helpEmbed = new EmbedBuilder()
      .setColor(MAIN_COLOR).setTitle("📜 Aide Inaya")
      .setDescription("`+antiraid` : Statut sécu | `+dmall` : Message général | `+snap @u` : 5 DMs snap | `+mp [msg] @u` : Message privé\n" +
      "`+ban`/`+kick`/`+unban` : Modération | `+clear [x]` : Supprime messages | `+renew` : Reset salon\n" +
      "`+addrole`/`+delrole` : Gère rôles | `+derank` : Full reset roles | `+mute`/`+unmute` : Timeout\n" +
      "`+lock`/`+unlock` : Perms salon | `+slowmode [s]` : Temps d'attente | `+lockname` : Fixe le pseudo.");
      message.channel.send({ embeds: [helpEmbed] });
  }
});

// Persistance
client.on('guildMemberUpdate', (o, n) => {
    if (db.lockedNicks[n.id] && n.displayName !== db.lockedNicks[n.id]) n.setNickname(db.lockedNicks[n.id]).catch(()=>{});
});

client.login(process.env.TOKEN);
