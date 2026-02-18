require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http'); // Ajout pour le serveur web
const { 
  Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, 
  ChannelType, Partials, ActivityType 
} = require('discord.js');

// -------------------- SERVEUR DE MAINTIEN (RENDER) --------------------
// Ce bloc empêche Render de couper ton bot
http.createServer((req, res) => {
  res.write("Inaya Bot est en ligne !");
  res.end();
}).listen(process.env.PORT || 3000, () => {
  console.log("🌐 Serveur de maintien activé sur le port " + (process.env.PORT || 3000));
});

// -------------------- CONFIGURATION --------------------
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
    try {
        db = JSON.parse(fs.readFileSync(dbPath));
    } catch (e) {
        console.error("Erreur de lecture de la DB, création d'une nouvelle.");
        saveDB();
    }
}

const client = new Client({
  intents: Object.values(GatewayIntentBits),
  partials: [Partials.Message, Partials.Channel, Partials.User, Partials.GuildMember]
});

// -------------------- INITIALISATION (STATUS STREAMING) --------------------
client.on('ready', () => {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);
    console.log(`📺 Statut Streaming activé : seïko votre Rois`);
    
    client.user.setActivity({
        name: 'seïko votre Rois',
        type: ActivityType.Streaming,
        url: 'https://www.twitch.tv/discord'
    });
});

// -------------------- HELPERS --------------------
const isOwner = (u) => u.id === OWNER_ID;
const isWL = (m) => isOwner(m.user) || db.whitelist.includes(m.id);
const isAdmin = (m) => isWL(m) || db.adminUsers.includes(m.id) || m.permissions.has(PermissionsBitField.Flags.Administrator);
const cooldowns = new Map();

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
        logChan = await guild.channels.create({ name: "commande-logs", type: ChannelType.GuildText, parent: category.id });
    }
    const embed = new EmbedBuilder().setColor(MAIN_COLOR).setDescription(content).setTimestamp();
    logChan.send({ embeds: [embed] }).catch(console.error);
}

// -------------------- ANTI-RAID --------------------
client.on('guildMemberAdd', async (member) => {
    if (!db.raidConfig.status) return;
    try {
        if (db.raidConfig.antiBot && member.user.bot) return member.kick("Anti-Bot");
        if (db.raidConfig.antiToken && (Date.now() - member.user.createdTimestamp) < 172800000) return member.kick("Anti-Token");
    } catch (err) {
        console.log(`Erreur Anti-Raid: ${err.message}`);
    }
});

// -------------------- COMMANDES (INCHANGÉES) --------------------
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith('+')) return;

  const now = Date.now();
  if (cooldowns.has(message.author.id) && now - cooldowns.get(message.author.id) < 1000) return;
  cooldowns.set(message.author.id, now);

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  try {
      if (command === 'dmall' && isOwner(message.author)) {
        const text = args.join(" ");
        if (!text) return message.reply("Message vide.");
        const members = (await message.guild.members.fetch()).filter(m => !m.user.bot);
        message.reply(`🚀 Dmall lancé sur ${members.size} membres.`);
        members.forEach(m => m.send(text).catch(() => {}));
        return sendLog(message.guild, `🚨 **DMALL** lancé par ${message.author.tag}`);
      }

      if (command === 'antiraid' && isOwner(message.author)) {
        db.raidConfig.status = !db.raidConfig.status; saveDB();
        return message.reply(`Anti-Raid ${db.raidConfig.status ? "Activé" : "Désactivé"}.`);
      }

      if (isWL(message.member)) {
        if (command === 'ban') {
          const target = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(()=>null);
          if (target?.kickable) { 
              await target.ban(); 
              message.reply("Banni."); 
              sendLog(message.guild, `🔨 **Ban**: ${target.user.tag} par ${message.author.tag}`); 
          }
        }
        
        if (command === 'mvalls') {
          const channel = message.guild.channels.cache.get(args[0]);
          if (!channel || channel.type !== ChannelType.GuildVoice) return message.reply("ID Salon Vocal invalide.");
          const members = message.guild.members.cache.filter(m => m.voice.channel);
          members.forEach(m => m.voice.setChannel(channel).catch(()=>{}));
          return message.reply(`Déplacement de ${members.size} personnes.`);
        }

        if (command === 'clear') {
            const target = message.mentions.users.first() || (args[0] ? await client.users.fetch(args[0]).catch(()=>null) : null);
            let msgs = await message.channel.messages.fetch({ limit: 100 });
            if (target) {
                msgs = msgs.filter(m => m.author.id === target.id);
                await message.channel.bulkDelete(msgs, true);
                message.reply(`Nettoyé les messages de ${target.tag}.`);
            } else {
                await message.channel.bulkDelete(100, true);
            }
            sendLog(message.guild, `🧹 **Clear** par ${message.author.tag}`);
        }

        if (command === 'renew') {
          const pos = message.channel.position;
          const newChan = await message.channel.clone();
          await message.channel.delete();
          newChan.setPosition(pos);
          return sendLog(newChan.guild, `🔄 **Renew** : Salon recréé par ${message.author.tag}`);
        }

        if (command === 'derank') {
            const target = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(()=>null);
            if (target) { await target.roles.set([]); message.reply("Rôles supprimés."); }
        }
      }

      if (isAdmin(message.member)) {
        if (command === 'mvall') {
            const channel = message.guild.channels.cache.get(args[0]);
            if (!message.member.voice.channel) return message.reply("Tu dois être en vocal.");
            const members = message.member.voice.channel.members;
            members.forEach(m => m.voice.setChannel(channel).catch(()=>{}));
            message.reply("Mouvement effectué.");
        }

        if (command === 'snap') {
          const target = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(()=>null);
          if (target) {
            for(let i=0; i<5; i++) { await target.send(`${message.member.displayName} te demande ton snap 💌`).catch(()=>{}); }
            message.reply("Requêtes envoyées.");
            sendLog(message.guild, `📸 **Snap** demandé à ${target.user.tag} par ${message.author.tag}`);
          }
        }

        if (command === 'mp') {
            const target = message.mentions.members.first() || await message.guild.members.fetch(args[args.length-1]).catch(()=>null);
            const msg = args.slice(0, -1).join(" ");
            if (target && msg) {
                await target.send(`${message.member.displayName} t'envoie : ${msg}`).catch(()=>{});
                message.reply("MP envoyé.");
            }
        }

        if (command === 'jail') {
            const target = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(()=>null);
            let role = message.guild.roles.cache.find(r => r.name === "Jail");
            if (!role) {
                role = await message.guild.roles.create({ name: "Jail", color: "#000001", permissions: [] });
                message.guild.channels.cache.forEach(c => c.permissionOverwrites.edit(role, { ViewChannel: false }));
            }
            if (target) { await target.roles.add(role); message.reply("Cible isolée."); }
        }

        if (command === 'lockname') {
            const target = message.mentions.members.first();
            if (target) { db.lockedNicks[target.id] = target.displayName; saveDB(); message.reply("Pseudo figé."); }
        }
      }

      if (command === 'ping') return message.reply("ta cru j'étais off btrd?");
      
      if (command === 'help') {
        const help = new EmbedBuilder().setColor(MAIN_COLOR).setTitle("📚 Inaya - Commandes")
        .addFields(
            { name: "👑 Owner", value: "`+dmall [msg]` : DM tout le serveur | `+antiraid` : ON/OFF sécu." },
            { name: "🛡️ Whitelist", value: "`+ban` : Bannit | `+mvalls [id]` : Move tout le vocal | `+clear [@u]` : Full wipe messages | `+renew` : Reset salon." },
            { name: "🛠️ Admin", value: "`+mvall [id]` : Move ton vocal | `+snap [@u]` : Spam snap | `+mp [msg] [@u]` : Envoie MP | `+jail [@u]` : Isole membre." },
            { name: "✨ Chill", value: "`+ping` : État bot | `+lockname` : Bloque pseudo | `+say` : Répète." }
        );
        return message.channel.send({ embeds: [help] });
      }

  } catch (error) {
      console.error(`Erreur commande ${command}:`, error);
  }
});

client.on('guildMemberUpdate', (o, n) => {
    if (db.lockedNicks[n.id] && n.displayName !== db.lockedNicks[n.id]) n.setNickname(db.lockedNicks[n.id]).catch(()=>{});
});

// Connexion sécurisée
if (!process.env.TOKEN) {
    console.error("❌ Erreur : Le TOKEN est manquant dans tes variables d'environnement Render !");
} else {
    client.login(process.env.TOKEN).catch(err => {
        console.error("❌ Impossible de se connecter à Discord. Vérifie ton Token et tes Privileged Intents :", err.message);
    });
}
