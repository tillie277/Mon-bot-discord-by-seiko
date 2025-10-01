require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField } = require('discord.js');
const express = require('express');
const fetch = require('node-fetch');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Keep-alive server pour Render
const app = express();
const PORT = process.env.PORT || 10000;
app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(PORT, () => console.log(`Keepalive server listening on port ${PORT}`));
setInterval(() => { fetch(`http://localhost:${PORT}/`).catch(()=>{}); }, 5*60*1000);

// Variables
const OWNER_ID = '726063885492158474';
const PREFIX = '+';
const cooldowns = new Map();
const doggedUsers = new Map();
const blacklist = new Set();
const whitelist = new Set();
const wetlist = new Set();
let snipeCache = null;
const permvUsers = new Set();

// Helper
function isOwner(id) { return id === OWNER_ID; }
function isAdmin(member) { return member.permissions.has(PermissionsBitField.Flags.Administrator); }
function isWL(id) { return whitelist.has(id); }
function isBL(id) { return blacklist.has(id); }
function checkPermission(member, type) {
    switch(type) {
        case 'owner': return isOwner(member.id);
        case 'admin': return isAdmin(member) || isOwner(member.id);
        case 'wl': return isWL(member.id) || isAdmin(member) || isOwner(member.id);
        case 'all': return true;
        default: return false;
    }
}

// Anti-spam simple : 5 messages d'affilé => avertissement 2s
const messageCounts = new Map();
client.on('messageCreate', message => {
    if(message.author.bot) return;
    const count = messageCounts.get(message.author.id) || 0;
    messageCounts.set(message.author.id, count+1);
    if(count+1 >= 5){
        message.channel.send(`${message.author}, attention, tu spam trop !`).then(msg=>{
            setTimeout(()=>msg.delete().catch(()=>{}),2000);
        });
        messageCounts.set(message.author.id,0);
    }
    setTimeout(()=>{
        const c = messageCounts.get(message.author.id) || 0;
        if(c>0) messageCounts.set(message.author.id, c-1);
    },5000);
});

// Snipe cache
client.on('messageDelete', message=>{
    if(message.author.bot) return;
    snipeCache = {
        content: message.content,
        author: message.author.tag
    };
});

// Command handler
client.on('messageCreate', async message=>{
    if(message.author.bot || !message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // HELP
    if(command==='help'){
        const helpEmbed = new EmbedBuilder()
            .setTitle('Liste des commandes')
            .setColor('Blue')
            .setDescription(`
+help : Affiche toutes les commandes (tous)

// ROLES
+addrole @user roleID | +delrole @user roleID (admin/WL/owner)
+derank @user (admin/WL/owner)

// LIMIT ROLES
+limitrole @role <max> | +unlimitrole @role (WL/owner)

// ANTIS
+antispam (owner)
+antibot (owner)
+antlink (owner)
+antiraid (owner)
+raidlog (admin/WL/owner)

// MISC
+clear @user <amount> | +clear <amount> (admin/WL/owner)
+slowmode <seconds> (admin/WL/owner)
+banner @user | +banner (tous)
+serverpic (admin/WL/owner)
+serverbanner (admin/WL/owner)

// DOG system
+dog @user (admin/WL/owner)
+undog @user (admin/WL/owner)
+undogall (admin/WL/owner)
+doglist (admin/WL/owner)

// MOVE / PERM / WAKEUP
+mv @user | +mv userID (admin/WL/owner/permMv users)
+permv @user | +unpermv @user | +permvlist (admin/WL/owner)
+wakeup @user <times> (admin/WL/owner)

// SNIPE
+snipe (tous) - montre dernier message supprimé, embed auto-supprimé 3s

// SNAP
+snap @user (admin/WL/owner) - DM 5x "@exec te demande ton snap" - cooldown 5min

// LISTES / MODERATION
+wl @user | +unwl @user | +wlist (owner/WL/admin)
+bl @user | +unbl @user | +blist (admin/WL/owner)
+ban @user | +unban @user | +banlist | +unbanall (admin/owner)
+wet @user | +unwet @user | +wetlist (admin/owner)
            `)
            .setFooter({text:`Owner bot : ${OWNER_ID}`});
        return message.channel.send({embeds:[helpEmbed]});
    }

    // DOG
    if(command==='dog'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const target = message.mentions.members.first();
        if(!target) return message.reply('Utilisateur introuvable');
        const displayName = `${target.displayName} (🦮 ${message.member.displayName})`;
        doggedUsers.set(target.id, displayName);
        await target.setNickname(displayName).catch(()=>{});
        message.channel.send(`${displayName} verrouillé en pseudo`);
    }

    if(command==='undog'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const target = message.mentions.members.first();
        if(!target) return message.reply('Utilisateur introuvable');
        doggedUsers.delete(target.id);
        await target.setNickname(null).catch(()=>{});
        message.channel.send(`${target.user.username} pseudo débloqué`);
    }

    if(command==='undogall'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        doggedUsers.forEach(async (v,k)=>{
            const m = await message.guild.members.fetch(k).catch(()=>null);
            if(m) await m.setNickname(null).catch(()=>{});
        });
        doggedUsers.clear();
        message.channel.send('Tous les pseudos débloqués');
    }

    if(command==='doglist'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const list = Array.from(doggedUsers.values()).join('\n') || 'Vide';
        message.channel.send(`Dogged users:\n${list}`);
    }

    // BLACKLIST
    if(command==='bl'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const target = message.mentions.members.first();
        if(!target) return message.reply('Utilisateur introuvable');
        blacklist.add(target.id);
        message.channel.send(`${target.user.tag} blacklisté et kické`);
        setTimeout(()=>target.kick('Blacklist'),3000);
    }

    if(command==='unbl'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const target = message.mentions.members.first();
        if(!target) return message.reply('Utilisateur introuvable');
        blacklist.delete(target.id);
        message.channel.send(`${target.user.tag} retiré de la blacklist`);
    }

    if(command==='blist'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const list = Array.from(blacklist).join('\n') || 'Vide';
        message.channel.send(`Blacklist:\n${list}`);
    }

    // WHITELIST
    if(command==='wl'){
        if(!isOwner(message.author.id)) return message.reply('Pas la permission');
        const target = message.mentions.members.first();
        if(!target) return message.reply('Utilisateur introuvable');
        whitelist.add(target.id);
        message.channel.send(`${target.user.tag} ajouté à la whitelist`);
    }

    if(command==='unwl'){
        if(!isOwner(message.author.id)) return message.reply('Pas la permission');
        const target = message.mentions.members.first();
        if(!target) return message.reply('Utilisateur introuvable');
        whitelist.delete(target.id);
        message.channel.send(`${target.user.tag} retiré de la whitelist`);
    }

    if(command==='wlist'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const list = Array.from(whitelist).join('\n') || 'Vide';
        message.channel.send(`Whitelist:\n${list}`);
    }

    // CLEAR
    if(command==='clear'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        let amount = parseInt(args[0]);
        if(message.mentions.members.first()){
            const target = message.mentions.members.first();
            amount = parseInt(args[1]);
            const messages = (await message.channel.messages.fetch({limit:100}))
                .filter(msg=>msg.author.id===target.id).first(amount);
            await message.channel.bulkDelete(messages,true).catch(()=>{});
        } else if(amount && !isNaN(amount)){
            await message.channel.bulkDelete(amount,true).catch(()=>{});
        } else return message.reply('Veuillez spécifier un nombre de messages');
        message.channel.send('Messages supprimés').then(m=>setTimeout(()=>m.delete(),3000));
    }

    // SNIPE
    if(command==='snipe'){
        if(!snipeCache) return message.reply('Rien à snipe');
        const embed = new EmbedBuilder()
            .setTitle('Dernier message supprimé')
            .setDescription(`${snipeCache.author}: ${snipeCache.content}`)
            .setColor('Yellow');
        message.channel.send({embeds:[embed]}).then(m=>setTimeout(()=>m.delete(),3000));
    }

    // BAN
    if(command==='ban'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const target = message.mentions.members.first();
        if(!target) return message.reply('Utilisateur introuvable');
        target.ban().then(()=>message.channel.send(`${target.user.tag} banni`)).catch(()=>{});
    }

    if(command==='unban'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const userId = args[0];
        if(!userId) return message.reply('Spécifiez un ID');
        message.guild.members.unban(userId).then(()=>message.channel.send(`${userId} débanni`)).catch(()=>{});
    }

    if(command==='banlist'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        message.guild.bans.fetch().then(bans=>{
            const list = bans.map(b=>b.user.tag).join('\n') || 'Vide';
            message.channel.send(`Banlist:\n${list}`);
        });
    }

    if(command==='unbanall'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        message.guild.bans.fetch().then(bans=>{
            bans.forEach(b=>message.guild.members.unban(b.user.id));
            message.channel.send('Tous les bans retirés');
        });
    }

    // LOCK PSEUDO pour +dog
    if(doggedUsers.has(message.member.id)){
        const lockedName = doggedUsers.get(message.member.id);
        if(message.member.displayName !== lockedName){
            await message.member.setNickname(lockedName).catch(()=>{});
        }
    }

    // -------------------------------
    // NOUVELLES COMMANDES
    // MOVE
    if(command==='mv'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const target = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(()=>null);
        if(!target) return message.reply('Utilisateur introuvable');
        if(!message.member.voice.channel) return message.reply('Tu dois être dans un vocal');
        await target.voice.setChannel(message.member.voice.channel).catch(()=>{});
        message.channel.send(`${target.user.tag} déplacé vers ton vocal`);
    }

    // PERMV
    if(command==='permv'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const target = message.mentions.members.first();
        if(!target) return message.reply('Utilisateur introuvable');
        permvUsers.add(target.id);
        message.channel.send(`${target.user.tag} peut maintenant être déplacé par tout admin/WL/owner`);
    }

    if(command==='unpermv'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const target = message.mentions.members.first();
        if(!target) return message.reply('Utilisateur introuvable');
        permvUsers.delete(target.id);
        message.channel.send(`${target.user.tag} n'a plus la permission de permv`);
    }

    if(command==='permvlist'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const list = Array.from(permvUsers).join('\n') || 'Vide';
        message.channel.send(`Permv users:\n${list}`);
    }

    // WAKEUP
    if(command==='wakeup'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const target = message.mentions.members.first();
        const times = Math.min(parseInt(args[1]||1),150);
        if(!target || !target.voice.channel) return message.reply('Utilisateur introuvable ou pas en vocal');
        for(let i=0;i<times;i++){
            await target.voice.setChannel(null).catch(()=>{});
            await new Promise(r=>setTimeout(r,500));
            await target.voice.setChannel(message.member.voice.channel).catch(()=>{});
        }
        await target.send(`Vous avez été wakeup ${times} fois par ${message.author.tag}`).catch(()=>{});
        message.channel.send(`Wakeup terminé pour ${target.user.tag}`);
    }

    // SNAP
    if(command==='snap'){
        if(!checkPermission(message.member,'wl')) return message.reply('Pas la permission');
        const target = message.mentions.members.first();
        if(!target) return message.reply('Utilisateur introuvable');
        if(cooldowns.get(`${message.author.id}-snap`)) return message.reply('Cooldown 5min');
        for(let i=0;i<5;i++){
            await target.send(`@exec te demande ton snap`).catch(()=>{});
        }
        cooldowns.set(`${message.author.id}-snap`, true);
        setTimeout(()=>cooldowns.delete(`${message.author.id}-snap`),5*60*1000);
        message.channel.send('Snap envoyé 5x');
    }
});

client.login(process.env.TOKEN).then(()=>console.log(`✅ Connecté en tant que ${client.user.tag}`));
