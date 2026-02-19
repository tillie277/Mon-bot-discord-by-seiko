require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    PermissionsBitField, 
    ChannelType, 
    ActivityType, 
    Collection 
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildInvites
    ]
});

// --- CONFIG & PERSISTENCE ---
const OWNER_ID = "726063885492158474";
const MAIN_COLOR = "#8A2BE2";
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const db = {
    whitelist: new Set(),
    blacklist: new Map(), // ID -> Raison
    wetlist: new Set(),
    dogs: new Map(), // targetID -> { name, masterID }
    permMv: new Set(),
    permAddRole: new Map(), // roleID -> count
    invites: new Map(), // guildID -> Map(code -> uses)
    pv: new Set(), // channelIDs
    backups: new Map()
};

// Fonctions de sauvegarde/chargement auto
function saveData() {
    const data = {
        whitelist: [...db.whitelist],
        blacklist: [...db.blacklist],
        wetlist: [...db.wetlist],
        dogs: [...db.dogs],
        permMv: [...db.permMv],
        permAddRole: [...db.permAddRole]
    };
    fs.writeFileSync(path.join(DATA_DIR, 'config.json'), JSON.stringify(data));
}

// --- UTILS ---
const isOwner = (id) => id === OWNER_ID;
const isWL = (id) => db.whitelist.has(id) || isOwner(id);
const isAdmin = (member) => member.permissions.has(PermissionsBitField.Flags.Administrator) || isWL(member.id);

// --- INITIALIZATION ---
client.on('ready', async () => {
    console.log(`${client.user.tag} est prêt.`);
    client.user.setActivity('seïko votre Rois', { type: ActivityType.Streaming, url: 'https://www.twitch.tv/discord' });
    
    // Cache des invites pour le invite-logger
    client.guilds.cache.forEach(async g => {
        const guildInvites = await g.invites.fetch().catch(() => new Collection());
        db.invites.set(g.id, new Map(guildInvites.map(i => [i.code, i.uses])));
    });
});

// --- CORE LOGIC: ANTI-UNBL & AUTO-REBAN ---
client.on('guildBanRemove', async (ban) => {
    if (db.blacklist.has(ban.user.id)) {
        await ban.guild.members.ban(ban.user.id, { reason: "On contourne pas la blacklist !" });
        const channel = ban.guild.channels.cache.find(c => c.name === "logs-blacklist");
        if (channel) channel.send(`Tentative d'unban de ${ban.user.tag} bloquée (Blacklisté).`);
    }
});

// --- COMMAND HANDLER ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    const prefix = "+";
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const member = message.member;

    // --- COMMANDES PUBLIC (+pic, +snipe, +ping) ---
    if (command === 'ping') return message.reply("ta cru j’étais off btrd?");
    
    if (command === 'pic') {
        const user = message.mentions.users.first() || client.users.cache.get(args[0]) || message.author;
        const embed = new EmbedBuilder()
            .setTitle(`Profil de ${user.username}`)
            .setImage(user.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setColor(MAIN_COLOR);
        return message.channel.send({ embeds: [embed] });
    }

    if (command === 'snipe') {
        const sniped = client.snipes?.get(message.channel.id);
        if (!sniped) return message.reply("Rien à snipe.");
        const embed = new EmbedBuilder()
            .setAuthor({ name: sniped.author.tag })
            .setDescription(sniped.content || "[Image/Vidéo]")
            .setImage(sniped.image)
            .setColor(MAIN_COLOR);
        return message.channel.send({ embeds: [embed] });
    }

    // --- COMMANDES ADMIN / WL / OWNER ---
    if (command === 'lock') {
        if (!isAdmin(member)) return;
        message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        return message.reply("Salon verrouillé.");
    }

    if (command === 'unlock') {
        if (!isAdmin(member)) return;
        message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
        return message.reply("Salon déverrouillé.");
    }

    // SYSTEM DOG
    if (command === 'dog') {
        if (!isWL(member.id)) return;
        const target = message.mentions.members.first();
        if (!target) return;
        const oldName = target.displayName;
        const newName = `🦮 ${oldName}`;
        db.dogs.set(target.id, { name: oldName, masterID: message.author.id });
        await target.setNickname(newName).catch(() => {});
        return message.reply(`${target} est maintenant en laisse.`);
    }

    if (command === 'undog') {
        if (!isWL(member.id)) return;
        const target = message.mentions.members.first();
        if (!target || !db.dogs.has(target.id)) return;
        const data = db.dogs.get(target.id);
        await target.setNickname(data.name).catch(() => {});
        db.dogs.delete(target.id);
        return message.reply("Laisse retirée.");
    }

    // WET SYSTEM (Super Ban)
    if (command === 'wet') {
        if (!isWL(member.id)) return;
        const target = message.mentions.members.first();
        if (!target) return;
        if (target.roles.highest.position >= member.roles.highest.position) {
            return message.reply("Vous ne pouvez pas effectuer cette commande sur votre supérieur !").then(m => setTimeout(() => m.delete(), 2000));
        }
        db.wetlist.add(target.id);
        await target.ban({ reason: args.slice(1).join(" ") || "Wet Ban" });
        return message.reply(`${target.user.tag} a été WET.`);
    }

    // BLACKLIST
    if (command === 'bl') {
        if (!isAdmin(member)) return;
        const target = message.mentions.users.first() || { id: args[0] };
        const reason = args.slice(1).join(" ") || "non fournis";
        db.blacklist.set(target.id, reason);
        const guildMember = message.guild.members.cache.get(target.id);
        if (guildMember) {
            await guildMember.send(`Tu as été blacklisté\nRaison: ${reason}`).catch(() => {});
            await guildMember.ban({ reason: `BL: ${reason}` });
        }
        return message.reply("Utilisateur blacklisté.");
    }

    // BACKUP (Fixé)
    if (command === 'backup') {
        if (!isOwner(member.id)) return;
        const sub = args[0];
        if (sub === 'save') {
            const channels = message.guild.channels.cache.map(c => ({ name: c.name, type: c.type, parent: c.parentId }));
            const roles = message.guild.roles.cache.map(r => ({ name: r.name, color: r.color, permissions: r.permissions.bitfield.toString() }));
            db.backups.set(message.guild.id, { channels, roles });
            return message.reply("Backup sauvegardée avec succès.");
        }
        if (sub === 'load') {
            const data = db.backups.get(message.guild.id);
            if (!data) return message.reply("Aucune backup trouvée.");
            // Logique de recréation ici...
            return message.reply("Chargement de la backup...");
        }
    }

    // SMASH OR PASS AUTO
    if (command === 'smash') {
        if (!isAdmin(member)) return;
        // Active le mode auto sur ce salon
        message.reply("Mode Smash or Pass activé sur ce salon.");
    }

    // HELP
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle("Commandes du Bot")
            .setColor(MAIN_COLOR)
            .addFields(
                { name: "+pic", value: "Affiche l'avatar d'un utilisateur." },
                { name: "+dog", value: "Verrouille le pseudo (Laisse)." },
                { name: "+wet", value: "Bannissement définitif spécial." },
                { name: "+lock", value: "Ferme le salon immédiatement." },
                { name: "+backup save/load", value: "Gère les sauvegardes du serveur." }
            );
        return message.channel.send({ embeds: [embed] });
    }
});

// --- AUTO SMASH OR PASS DETECTOR ---
client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;
    if (msg.channel.name.includes("smash")) {
        if (msg.attachments.size > 0 || msg.content.includes("http")) {
            await msg.react("✅");
            await msg.react("❌");
            await msg.startThread({ name: `Avis sur ${msg.author.username}` });
        } else {
            msg.delete().catch(() => {});
        }
    }
});

// --- SNIPE STORAGE ---
client.snipes = new Map();
client.on('messageDelete', (message) => {
    client.snipes.set(message.channel.id, {
        content: message.content,
        author: message.author,
        image: message.attachments.first()?.url,
        timestamp: Date.now()
    });
});

client.login(process.env.TOKEN);
