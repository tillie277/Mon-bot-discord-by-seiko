require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType, ActivityType, AuditLogEvent, Partials } = require('discord.js');

// -------------------- CONFIGURATION & CONSTANTES --------------------
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "726063885492158474"; // Remplace par ton ID si besoin
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 🩺 GUÉRISON : Noms de variables valides et emojis Discord officiels
const check = '✅';
const cross = '❌';

const PATHS = {
    settings: path.join(DATA_DIR, 'settings.json'),
    lists: path.join(DATA_DIR, 'lists.json'),
    backups: path.join(DATA_DIR, 'backups.json')
};

// -------------------- CLIENT --------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildInvites
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

// -------------------- BASES DE DONNÉES EN MÉMOIRE --------------------
let db = {
    prefixes: {}, welcomeChannels: {}, ghostJoins: {}, inviteLogs: {},
    smashPass: [], jailRoles: {}
};
let lists = {
    whitelist: [], adminUsers: [], blacklist: [], wetList: [], banList: [],
    dogs: {}, permMv: [], permMvRoles: [], permAddRoles: {}, fabulous: [],
    lockedNames: [], pvChannels: {}, lockedTextChannels: []
};
let backups = {};

function loadDB() {
    try { if (fs.existsSync(PATHS.settings)) db = JSON.parse(fs.readFileSync(PATHS.settings)); } catch (e) {}
    try { if (fs.existsSync(PATHS.lists)) lists = JSON.parse(fs.readFileSync(PATHS.lists)); } catch (e) {}
    try { if (fs.existsSync(PATHS.backups)) backups = JSON.parse(fs.readFileSync(PATHS.backups)); } catch (e) {}
}
function saveDB() {
    fs.writeFileSync(PATHS.settings, JSON.stringify(db, null, 2));
    fs.writeFileSync(PATHS.lists, JSON.stringify(lists, null, 2));
    fs.writeFileSync(PATHS.backups, JSON.stringify(backups, null, 2));
}
loadDB();
setInterval(saveDB, 60000);

// Caches temporaires
client.snipes = new Map();
client.guildInvites = new Map();
let antiraidState = false;
let recentJoins = [];

// -------------------- UTILS --------------------
const isOwner = id => id === OWNER_ID;
const isWL = id => lists.whitelist.includes(id) || isOwner(id);
const isAdmin = member => {
    if (!member) return false;
    return isWL(member.id) || lists.adminUsers.includes(member.id) || member.permissions.has(PermissionsBitField.Flags.Administrator);
};
const getPrefix = guildId => db.prefixes[guildId] || '+';
const simpleEmbed = (title, desc) => new EmbedBuilder().setTitle(title).setDescription(desc).setColor(MAIN_COLOR);

// -------------------- EVENTS --------------------
client.once('ready', async () => {
    console.log(`✓ Connecté en tant que ${client.user.tag}`);
    client.user.setActivity({ name: 'seïko votre Rois', type: ActivityType.Streaming, url: 'https://www.twitch.tv/discord' });
    
    client.guilds.cache.forEach(async guild => {
        try {
            const invites = await guild.invites.fetch();
            client.guildInvites.set(guild.id, invites);
        } catch (e) {}
    });
});

client.on('inviteCreate', async invite => {
    const invites = await invite.guild.invites.fetch().catch(() => null);
    if(invites) client.guildInvites.set(invite.guild.id, invites);
});

client.on('inviteDelete', async invite => {
    const invites = await invite.guild.invites.fetch().catch(() => null);
    if(invites) client.guildInvites.set(invite.guild.id, invites);
});

client.on('messageDelete', message => {
    if (message.author?.bot) return;
    client.snipes.set(message.channel.id, {
        content: message.content,
        author: message.author,
        image: message.attachments.first()?.url,
        timestamp: Date.now()
    });
});

client.on('guildMemberAdd', async member => {
    const guild = member.guild;
    
    // Anti-Raid
    if (antiraidState) {
        recentJoins.push({ id: member.id, time: Date.now() });
        recentJoins = recentJoins.filter(j => Date.now() - j.time < 10000);
        if (recentJoins.length > 4) {
            member.kick("Anti-Raid Actif").catch(()=>{});
            return;
        }
    }

    // Auto-Reban BL
    if (lists.blacklist.includes(member.id)) {
        await member.ban({ reason: "on contourne pas la blacklist !" }).catch(()=>{});
        member.send("Tu as été blacklisté !\nRaison: on contourne pas la blacklist !").catch(()=>{});
        return;
    }

    // Ghost Joins
    if (db.ghostJoins[guild.id]) {
        const ch = guild.channels.cache.get(db.ghostJoins[guild.id]);
        if (ch) ch.send(`<@${member.id}>`).then(m => m.delete()).catch(()=>{});
    }

    // Welcome Message
    if (db.welcomeChannels[guild.id]) {
        const ch = guild.channels.cache.get(db.welcomeChannels[guild.id].channel);
        if (ch) ch.send(`${member} ${db.welcomeChannels[guild.id].msg}`).catch(()=>{});
    }

    // Invite Logger
    if (db.inviteLogs[guild.id]) {
        const cachedInvites = client.guildInvites.get(guild.id) || new Map();
        const newInvites = await guild.invites.fetch().catch(() => new Map());
        const usedInvite = newInvites.find(inv => {
            const cached = cachedInvites.get(inv.code);
            return cached && inv.uses > cached.uses;
        });
        client.guildInvites.set(guild.id, newInvites);

        let inviterText = "une invitation inconnue";
        if (usedInvite && usedInvite.inviter) {
            inviterText = `<@${usedInvite.inviter.id}>, qui a maintenant **${usedInvite.uses}** invitations`;
        }
        
        const ch = guild.channels.cache.get(db.inviteLogs[guild.id]);
        if (ch) {
            const embed = new EmbedBuilder()
                .setDescription(`Nouveau membre sur **${guild.name}** !\n\n<@${member.id}> vient de rejoindre. Ils ont été invités par ${inviterText} ! 🎉`)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: `Aujourd'hui à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` })
                .setColor("#2b2d31");
            ch.send({ embeds: [embed] }).catch(()=>{});
        }
    }
});

client.on('guildMemberRemove', async member => {
    const guild = member.guild;
    if (db.inviteLogs[guild.id]) {
        const ch = guild.channels.cache.get(db.inviteLogs[guild.id]);
        if (ch) {
            const embed = new EmbedBuilder()
                .setDescription(`Départ d'un membre de **${guild.name}** !\n\n**${member.user.username}** a quitté le serveur. 😢`)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: `${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` })
                .setColor("#FF0000");
            ch.send({ embeds: [embed] }).catch(()=>{});
        }
    }
});

// Protection Miroir FabulousBot & Dogs
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!newState.member) return;
    
    // PV system
    const vc = newState.channelId;
    if (vc && lists.pvChannels[vc]) {
        const pv = lists.pvChannels[vc];
        if (!pv.allowed.includes(newState.id) && !isAdmin(newState.member)) {
            setTimeout(() => { if(newState.member.voice.channelId === vc) newState.disconnect().catch(()=>{}); }, 1000);
            newState.member.send(`⛔ Accès refusé au salon vocal.\nMotif: protégé par un rang supérieur.`).catch(()=>{});
        }
    }

    // Dog follow
    if (lists.dogs[newState.id] && newState.channelId) {
        const master = newState.guild.members.cache.get(lists.dogs[newState.id].executor);
        if (master?.voice.channelId && newState.channelId !== master.voice.channelId) {
            newState.setChannel(master.voice.channelId).catch(()=>{});
        }
    } else {
        Object.keys(lists.dogs).forEach(dogId => {
            if (lists.dogs[dogId].executor === newState.id && newState.channelId) {
                const dog = newState.guild.members.cache.get(dogId);
                if (dog?.voice.channelId !== newState.channelId) dog?.voice.setChannel(newState.channelId).catch(()=>{});
            }
        });
    }

    // FabulousBot Protection (Mute/Deafen/Disconnect)
    if (lists.fabulous.includes(newState.id)) {
        if ((!oldState.serverMute && newState.serverMute) || (!oldState.serverDeaf && newState.serverDeaf) || (oldState.channelId && !newState.channelId)) {
            if (newState.serverMute) newState.setMute(false).catch(()=>{});
            if (newState.serverDeaf) newState.setDeaf(false).catch(()=>{});
            try {
                const logs = await newState.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberUpdate });
                const log = logs.entries.first();
                if (log && log.target.id === newState.id && log.executor) {
                    const attacker = newState.guild.members.cache.get(log.executor.id);
                    if (attacker && attacker.voice.channel) {
                        if (newState.serverMute) attacker.voice.setMute(true).catch(()=>{});
                        if (newState.serverDeaf) attacker.voice.setDeaf(true).catch(()=>{});
                    }
                }
            } catch (e) {}
        }
    }
});

client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    
    // Smash or pass auto
    if (db.smashPass.includes(message.channel.id)) {
        if (message.attachments.size === 0 && !message.content.includes('http')) {
            return message.delete().catch(()=>{});
        }
        await message.react(check);
        await message.react(cross);
        await message.startThread({ name: `Avis sur ${message.author.username}`, autoArchiveDuration: 60 }).catch(()=>{});
        return;
    }

    const prefix = getPrefix(message.guild.id);
    if (!message.content.startsWith(prefix) && !message.content.startsWith('-')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    const targetUser = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
    const targetRole = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);

    // 🩺 GUÉRISON : Ajout des accolades { } dans les cases pour sécuriser la portée des variables (Lexical Scope)
    switch (command) {
        case 'ping':
            message.channel.send("ta cru j’étais off btrd?");
            break;
            
        case 'help': {
            const helpEmbed = new EmbedBuilder()
                .setTitle("Commandes du Bot")
                .setDescription("Voici la liste des commandes. Préfixe: " + prefix)
                .addFields(
                    { name: "👑 Modération & Admin", value: "`+lock`, `+unlock`, `+clear`, `+ban`, `+unban`, `+kick`, `+mute`, `+unmute`, `+bl`, `+unbl`, `+wet`, `+unwet`" },
                    { name: "🛡️ Protections", value: "`+antiraid`, `+dog`, `+undog`, `+fabulousbot`" },
                    { name: "🛠️ Utilitaires", value: "`+snipe`, `+pic`, `+banner`, `+say`, `+pv`, `+smash`, `+inviteloger`, `+ghostjoins`" }
                ).setColor(MAIN_COLOR);
            message.channel.send({ embeds: [helpEmbed] });
            break;
        }

        case 'setprefix': {
            if (!isOwner(message.author.id)) return;
            const newPrefix = args[0];
            if (!newPrefix) return message.reply("Veuillez fournir un préfixe.");
            message.reply(`Voulez-vous vraiment changer le préfixe en \`${newPrefix}\` ? Répondez oui ou non.`).then(() => {
                const filter = m => m.author.id === message.author.id;
                message.channel.awaitMessages({ filter, max: 1, time: 15000, errors: ['time'] }).then(col => {
                    if (col.first().content.toLowerCase() === 'oui') {
                        db.prefixes[message.guild.id] = newPrefix;
                        saveDB();
                        message.channel.send(`${check} Le préfixe est maintenant \`${newPrefix}\``);
                    } else message.channel.send(`${cross} Annulé.`);
                }).catch(() => message.channel.send("Temps écoulé."));
            });
            break;
        }

        case 'snipe': {
            const sniped = client.snipes.get(message.channel.id);
            if (!sniped) return message.reply("Aucun message à snipe !");
            const snEmbed = new EmbedBuilder().setAuthor({ name: sniped.author.tag, iconURL: sniped.author.displayAvatarURL() }).setDescription(sniped.content || "*Message sans texte*").setColor(MAIN_COLOR).setTimestamp(sniped.timestamp);
            if (sniped.image) snEmbed.setImage(sniped.image);
            message.channel.send({ embeds: [snEmbed] });
            break;
        }

        case 'pic': {
            const tPic = message.mentions.users.first() || message.author;
            message.channel.send({ embeds: [new EmbedBuilder().setTitle(`Photo de profil de ${tPic.username}`).setImage(tPic.displayAvatarURL({ dynamic: true, size: 1024 })).setColor(MAIN_COLOR)] });
            break;
        }

        case 'say': {
            if (!isAdmin(message.member)) return;
            const chanSay = message.mentions.channels.first() || message.channel;
            const sayMsg = message.mentions.channels.first() ? args.slice(1).join(" ") : args.join(" ");
            if(sayMsg) {
                chanSay.send(sayMsg);
                if (message.channel.id === chanSay.id) message.delete().catch(()=>{});
            }
            break;
        }

        case 'clear': {
            if (!isAdmin(message.member)) return;
            const amount = parseInt(args[0]) || (targetUser ? parseInt(args[1]) : 0);
            if (amount < 1 || amount > 100) return message.reply("Indiquez un nombre entre 1 et 100.");
            if (targetUser) {
                const msgs = await message.channel.messages.fetch({ limit: 100 });
                const uMsgs = msgs.filter(m => m.author.id === targetUser.id).first(amount);
                await message.channel.bulkDelete(uMsgs, true);
            } else {
                await message.channel.bulkDelete(amount, true);
            }
            message.channel.send(`${check} Messages supprimés.`).then(m => setTimeout(()=>m.delete(), 2000));
            break;
        }

        case 'lock':
            if (!isWL(message.author.id) && !isAdmin(message.member)) return;
            message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
            message.channel.send(`🔒 Salon verrouillé par ${message.author}. Seuls les admins/WL peuvent parler.`);
            break;

        case 'unlock':
            if (!isWL(message.author.id) && !isAdmin(message.member)) return;
            message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
            message.channel.send(`🔓 Salon déverrouillé.`);
            break;

        case 'bl': {
            if (!isAdmin(message.member)) return;
            if (!targetUser) return;
            if (isWL(targetUser.id)) return message.reply("Tu ne peux pas BL un WL.");
            const reasonBl = args.slice(1).join(" ") || "non fournis";
            lists.blacklist.push(targetUser.id);
            saveDB();
            targetUser.send(`Tu as été blacklisté !\nRaison: ${reasonBl}`).catch(()=>{});
            targetUser.ban({ reason: `BL: ${reasonBl}` }).catch(()=>{});
            message.channel.send(`${check} ${targetUser.user.tag} blacklisté.`);
            break;
        }

        case 'unbl': {
            if (!isOwner(message.author.id) && !isWL(message.author.id) && !isAdmin(message.member)) return;
            const blId = args[0]?.replace(/[<@!>]/g,'');
            lists.blacklist = lists.blacklist.filter(id => id !== blId);
            saveDB();
            message.guild.members.unban(blId).catch(()=>{});
            message.channel.send(`${check} Utilisateur retiré de la BL.`);
            break;
        }

        case 'wet':
            if (!isWL(message.author.id) && !isOwner(message.author.id)) return;
            if (!targetUser) return;
            if (targetUser.roles.highest.position >= message.member.roles.highest.position && !isOwner(message.author.id)) {
                return message.reply("Vous ne pouvez pas effectuer cette commande sur votre supérieur !").then(m => setTimeout(()=>m.delete(), 2000));
            }
            lists.wetList.push(targetUser.id);
            saveDB();
            targetUser.ban({ reason: "Wet par un Sys+" }).catch(()=>{});
            message.channel.send(`${check} ${targetUser.user.tag} a été WET.`);
            break;

        case 'unwet': {
            if (!isWL(message.author.id) && !isOwner(message.author.id)) {
                return message.reply("Attention à toi tu essaie de unban un utilisateur qui a été Wet par un Sys+.");
            }
            const wetId = args[0]?.replace(/[<@!>]/g,'');
            lists.wetList = lists.wetList.filter(id => id !== wetId);
            saveDB();
            message.guild.members.unban(wetId).catch(()=>{});
            message.channel.send(`${check} Utilisateur Un-WET.`);
            break;
        }

        case 'unbanall': {
            if (!isAdmin(message.member)) return;
            const bans = await message.guild.bans.fetch();
            bans.forEach(ban => {
                if (!lists.blacklist.includes(ban.user.id) && !lists.wetList.includes(ban.user.id)) {
                    message.guild.members.unban(ban.user.id).catch(()=>{});
                }
            });
            message.channel.send(`${check} Tous les membres (hors BL/WET) ont été débannis.`);
            break;
        }

        case 'baninfo':
        case 'blinfo': {
            const infoId = args[0]?.replace(/[<@!>]/g,'');
            if(!infoId) return;
            const banInfo = await message.guild.bans.fetch(infoId).catch(()=>null);
            if(banInfo) {
                const emb = new EmbedBuilder()
                    .setTitle(`📜 Informations sur le ${command === 'blinfo' ? 'Blacklist' : 'Bannissement'}`)
                    .setDescription(`\n👤 **Utilisateur :**\nNom d'utilisateur : ${banInfo.user.username}\nIdentifiant : ${banInfo.user.id}\n\n📄 **Informations :**\nRaison : ${banInfo.reason || 'Aucune'}\n`)
                    .setColor(MAIN_COLOR);
                message.channel.send({ embeds: [emb] });
            }
            break;
        }

        case 'dog':
            if (!isWL(message.author.id) && !isOwner(message.author.id) && !isAdmin(message.member)) return;
            if (!targetUser) return;
            if (lists.fabulous.includes(targetUser.id)) {
                lists.dogs[message.author.id] = { executor: targetUser.id, oldName: message.member.displayName };
                message.member.setNickname(`${message.member.displayName} ( 🦮${targetUser.displayName} )`).catch(()=>{});
                return message.channel.send(`FabulousBot : Retour à l'envoyeur ! Tu es maintenant le dog.`);
            }
            lists.dogs[targetUser.id] = { executor: message.author.id, oldName: targetUser.displayName };
            saveDB();
            targetUser.setNickname(`${targetUser.displayName} ( 🦮${message.member.displayName} )`).catch(()=>{});
            message.channel.send(`🦮 ${targetUser} est maintenant le chien de ${message.author}`);
            break;

        case 'undog': {
            if (!isWL(message.author.id) && !isOwner(message.author.id) && !isAdmin(message.member)) return;
            const dogId = targetUser ? targetUser.id : args[0];
            if (lists.dogs[dogId]) {
                const dogUser = message.guild.members.cache.get(dogId);
                if (dogUser) dogUser.setNickname(lists.dogs[dogId].oldName).catch(()=>{});
                delete lists.dogs[dogId];
                saveDB();
                message.channel.send(`${check} Libéré de sa laisse.`);
            }
            break;
        }

        case 'fabulousbot':
            if (!isOwner(message.author.id)) return;
            if (!targetUser) return;
            lists.fabulous.push(targetUser.id);
            saveDB();
            message.channel.send(`✨ ${targetUser} est maintenant un FabulousBot (Intouchable) !`);
            break;

        case 'flood': {
            if (!targetUser) return message.reply("Mentionnez une cible.");
            const maxMsg = Math.min(parseInt(args[1]) || 10, 10);
            const floods = [
                `AHHAH OHOHOH AHHAAH OHOHO HAHA OHOH HAHA OHOH H AHHA     HOOHOOOAAOO ${targetUser}`,
                `FERME TA CHATTE FERME TA CHATTE SALE CHIENNASSE SUCEUSE DE BITES TA PTITE SOEUR LA CATIN D'CHIENNE TROU DU CUL SALE CHIENNASSE SALE CHIENNASSE ENFANT DE CATIN ${targetUser}`,
                `PTITE PUTE FILS DE PUTE GRANDE LANGUEUSE TA GUEULE ENFANT DE VI@LE TA MERE LA PUTE TROU DU CUL PTITE PUTE TA MERE LA PUTE ${targetUser}`,
                `SALE CHIENNASSE TA SAINTE PUTE DE MERE TA MERE LA PUTE TA MERE LA PUTE ENFANT DE CATIN QUE TU ES FERME TA CHATTE QUE TU ES ${targetUser}`,
                `SUCE BITE SUCE FLUTE SUCE ARTICHAUD SUCE TOUT SUCE SALOPE SUCE TRANS TG MEC EN KARANSSE ${targetUser}`,
                `TA LA GEULE A ZW TETE DE BITE T PAS BEAU JE TE QUITTEEEEEEE  ${targetUser}`,
                `JE TE BZ TA PUTE DE MERE ESPECE DE GRANDE PUTE ${targetUser}`
            ];
            for (let i = 0; i < maxMsg; i++) {
                const rmd = floods[Math.floor(Math.random() * floods.length)];
                message.channel.send(`## ${rmd}`);
            }
            break;
        }

        case 'smash':
            db.smashPass.push(message.channel.id);
            saveDB();
            message.channel.send(`${check} Ce salon est maintenant un salon Smash or Pass.`);
            break;

        case 'inviteloger':
            db.inviteLogs[message.guild.id] = message.channel.id;
            saveDB();
            message.channel.send(`${check} Invite Logger activé dans ce salon.`);
            break;

        case 'ghostjoins':
            if (!isWL(message.author.id) && !isOwner(message.author.id)) return;
            if (args[0] === 'off') {
                delete db.ghostJoins[message.guild.id];
                message.channel.send(`${check} GhostJoins désactivé.`);
            } else {
                db.ghostJoins[message.guild.id] = message.channel.id;
                message.channel.send(`${check} GhostJoins activé ici.`);
            }
            saveDB();
            break;

        case 'pv': {
            if (!isAdmin(message.member)) return;
            const vcPv = message.member.voice.channel;
            if (!vcPv) return message.reply("Tu dois être en vocal.");
            lists.pvChannels[vcPv.id] = { allowed: [message.author.id] };
            saveDB();
            vcPv.permissionOverwrites.edit(message.guild.roles.everyone, { Connect: false });
            vcPv.permissionOverwrites.edit(message.author.id, { Connect: true });
            message.channel.send(`🔒 Salon vocal ${vcPv.name} passé en privé.`);
            break;
        }

        case 'pvacces': {
            const vca = message.member.voice.channel;
            if(vca && lists.pvChannels[vca.id] && targetUser) {
                lists.pvChannels[vca.id].allowed.push(targetUser.id);
                vca.permissionOverwrites.edit(targetUser.id, { Connect: true });
                message.channel.send(`${check} Accès donné à ${targetUser}`);
            }
            break;
        }

        case 'unpvs':
        case 'unpv': {
            if (!isAdmin(message.member)) return;
            const vcd = message.member.voice.channel;
            if(vcd) {
                delete lists.pvChannels[vcd.id];
                vcd.permissionOverwrites.edit(message.guild.roles.everyone, { Connect: null });
                message.channel.send(`🔓 Salon vocal redevenu public.`);
            }
            break;
        }

        case 'permmv':
            if (!isAdmin(message.member)) return;
            if (targetRole) {
                lists.permMvRoles.push(targetRole.id);
                saveDB();
                message.channel.send(`${check} Le rôle ${targetRole.name} a accès au +mv`);
            }
            break;

        case 'mv':
            if (!isWL(message.author.id) && !isAdmin(message.member) && !message.member.roles.cache.some(r => lists.permMvRoles.includes(r.id))) return;
            if (!targetUser || !targetUser.voice.channel || !message.member.voice.channel) return;
            if (lists.fabulous.includes(targetUser.id)) {
                message.member.voice.setChannel(targetUser.voice.channel).catch(()=>{});
                return message.channel.send(`FabulousBot reflection: c'est toi qui a été déplacé.`);
            }
            targetUser.voice.setChannel(message.member.voice.channel).catch(()=>{});
            message.channel.send(`${check} Déplacé !`);
            break;

        case 'antiraid':
            if (!isOwner(message.author.id)) return;
            antiraidState = !antiraidState;
            message.channel.send(antiraidState ? `${check} Anti-Raid activé (Niveau Maximum).` : `${cross} Anti-Raid désactivé.`);
            break;
            
        case 'backup':
            if (args[0] === 'save') {
                backups[message.guild.id] = {
                    roles: message.guild.roles.cache.map(r => ({ name: r.name, color: r.color, perm: r.permissions.bitfield })),
                    channels: message.guild.channels.cache.map(c => ({ name: c.name, type: c.type, parent: c.parentId }))
                };
                saveDB();
                message.channel.send(`${check} Backup sauvegardée.`);
            } else if (args[0] === 'load') {
                if (!backups[message.guild.id]) return message.reply("Aucune backup trouvée.");
                message.channel.send("Chargement de la backup (les rôles et salons vont être restaurés).");
            }
            break;

        case 'snap':
            if (!isAdmin(message.member)) return;
            if (targetUser) {
                targetUser.send(`${message.member.displayName} te demande ton snap 💌`).catch(()=>{});
                message.channel.send(`${check} Demande envoyée.`);
            }
            break;

        case 'mp':
            if (!isAdmin(message.member)) return;
            if (targetUser && args.slice(1).length > 0) {
                targetUser.send(`${message.member.displayName} : ${args.slice(1).join(" ")}`).catch(()=>{});
            }
            break;

        case 'dmall': {
            if (!isOwner(message.author.id)) return;
            const msgDmall = args.join(" ");
            message.guild.members.cache.forEach((m, index) => {
                if(!m.user.bot) setTimeout(() => m.send(msgDmall).catch(()=>{}), index * 1000);
            });
            message.channel.send(`${check} Envoi des MPs en cours...`);
            break;
        }

        case 'wl':
            if (!isOwner(message.author.id)) return;
            if(targetUser) {
                lists.whitelist.push(targetUser.id);
                saveDB();
                message.channel.send(`${check} ${targetUser.user.tag} est maintenant WL.`);
            }
            break;

    }
});

// Connexion
client.login(process.env.TOKEN);
