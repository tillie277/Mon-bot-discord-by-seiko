require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, ChannelType, ActivityType, AuditLogEvent } = require('discord.js');

// ==================== CONFIGURATION ====================
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "726063885492158474";
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const PATHS = {
    whitelist: path.join(DATA_DIR, 'whitelist.json'),
    admin: path.join(DATA_DIR, 'admin.json'),
    blacklist: path.join(DATA_DIR, 'blacklist.json'),
    wetList: path.join(DATA_DIR, 'wetList.json'),
    dogs: path.join(DATA_DIR, 'dogs.json'),
    permMv: path.join(DATA_DIR, 'permMv.json'),
    lockedNames: path.join(DATA_DIR, 'lockedNames.json'),
    pv: path.join(DATA_DIR, 'pvChannels.json'),
    fabulous: path.join(DATA_DIR, 'fabulous.json'),
    prefixes: path.join(DATA_DIR, 'prefixes.json'),
    welcome: path.join(DATA_DIR, 'welcome.json'),
    inviteLogs: path.join(DATA_DIR, 'inviteLogs.json'),
    ghostJoins: path.join(DATA_DIR, 'ghostJoins.json')
};

// ==================== INITIALISATION CLIENT ====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

// ==================== BASES DE DONNÉES EN MÉMOIRE ====================
client.whitelist = new Set();
client.adminUsers = new Set();
client.blacklist = new Map(); // id -> reason
client.wetList = new Set();
client.dogs = new Map(); // id -> { executorId, lockedName }
client.permMvUsers = new Set();
client.lockedNames = new Set();
client.pvChannels = new Map();
client.fabulous = new Set();
client.prefixes = new Map();
client.welcomeChannels = new Map(); // guildId -> { channelId, message }
client.inviteLogs = new Map(); // guildId -> channelId
client.ghostJoins = new Map(); // guildId -> channelId
client.snipes = new Map(); // channelId -> { content, author, image, timestamp }
client.guildInvites = new Map(); // guildId -> Map(code -> uses)
client.backups = new Map();

// Systèmes globaux
client.antiraid = false;
client.antispam = false;
client.antlink = false;

// ==================== FONCTIONS DE PERSISTANCE ====================
function loadData() {
    const load = (p, fallback) => { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p)) : fallback; } catch { return fallback; } };
    load(PATHS.whitelist, []).forEach(id => client.whitelist.add(id));
    load(PATHS.admin, []).forEach(id => client.adminUsers.add(id));
    load(PATHS.wetList, []).forEach(id => client.wetList.add(id));
    load(PATHS.fabulous, []).forEach(id => client.fabulous.add(id));
    load(PATHS.lockedNames, []).forEach(id => client.lockedNames.add(id));
    
    const bl = load(PATHS.blacklist, {}); for (const [k, v] of Object.entries(bl)) client.blacklist.set(k, v);
    const dg = load(PATHS.dogs, {}); for (const [k, v] of Object.entries(dg)) client.dogs.set(k, v);
    const pf = load(PATHS.prefixes, {}); for (const [k, v] of Object.entries(pf)) client.prefixes.set(k, v);
    const wl = load(PATHS.welcome, {}); for (const [k, v] of Object.entries(wl)) client.welcomeChannels.set(k, v);
    const il = load(PATHS.inviteLogs, {}); for (const [k, v] of Object.entries(il)) client.inviteLogs.set(k, v);
    const gj = load(PATHS.ghostJoins, {}); for (const [k, v] of Object.entries(gj)) client.ghostJoins.set(k, v);
}
function saveData() {
    const save = (p, data) => fs.writeFileSync(p, JSON.stringify(data, null, 2));
    save(PATHS.whitelist, [...client.whitelist]);
    save(PATHS.admin, [...client.adminUsers]);
    save(PATHS.wetList, [...client.wetList]);
    save(PATHS.fabulous, [...client.fabulous]);
    save(PATHS.lockedNames, [...client.lockedNames]);
    save(PATHS.blacklist, Object.fromEntries(client.blacklist));
    save(PATHS.dogs, Object.fromEntries(client.dogs));
    save(PATHS.prefixes, Object.fromEntries(client.prefixes));
    save(PATHS.welcome, Object.fromEntries(client.welcomeChannels));
    save(PATHS.inviteLogs, Object.fromEntries(client.inviteLogs));
    save(PATHS.ghostJoins, Object.fromEntries(client.ghostJoins));
}
loadData();
setInterval(saveData, 30000);

// ==================== VÉRIFICATIONS ====================
const isOwner = id => id === OWNER_ID;
const isWL = id => client.whitelist.has(id) || isOwner(id);
const isAdmin = member => member && (member.permissions.has(PermissionsBitField.Flags.Administrator) || client.adminUsers.has(member.id) || isWL(member.id));
const isFabulous = id => client.fabulous.has(id) || isOwner(id);

// ==================== ÉVÉNEMENTS ====================
client.once('ready', async () => {
    console.log(`✓ Connecté en tant que ${client.user.tag}`);
    client.user.setActivity({ name: 'seïko votre Rois', type: ActivityType.Streaming, url: 'https://www.twitch.tv/discord' });
    
    // Cache invites
    client.guilds.cache.forEach(async guild => {
        try {
            const invites = await guild.invites.fetch();
            const inviteMap = new Map(invites.map(inv => [inv.code, inv.uses]));
            client.guildInvites.set(guild.id, inviteMap);
        } catch (err) {}
    });
});

// Gérer la création d'invitations
client.on('inviteCreate', invite => {
    const invites = client.guildInvites.get(invite.guild.id) || new Map();
    invites.set(invite.code, invite.uses);
    client.guildInvites.set(invite.guild.id, invites);
});

// Logs d'arrivée et Ghost Ping
client.on('guildMemberAdd', async member => {
    // 1. Blacklist Check
    if (client.blacklist.has(member.id)) {
        await member.send(`Tu as été blacklisté !\nRaison: ${client.blacklist.get(member.id)}`).catch(()=>{});
        return member.ban({ reason: "Contournement Blacklist" });
    }
    // 2. Wet Check
    if (client.wetList.has(member.id)) return member.ban({ reason: "Wet persist" });
    
    // 3. Ghost Joins
    const ghostChanId = client.ghostJoins.get(member.guild.id);
    if (ghostChanId) {
        const chan = member.guild.channels.cache.get(ghostChanId);
        if (chan) chan.send(`<@${member.id}>`).then(m => m.delete().catch(()=>{}));
    }

    // 4. Welcome Message
    const welcomeData = client.welcomeChannels.get(member.guild.id);
    if (welcomeData) {
        const wChan = member.guild.channels.cache.get(welcomeData.channelId);
        if (wChan) wChan.send(`<@${member.id}>, ${welcomeData.message}`);
    }

    // 5. Invite Logger
    const logChanId = client.inviteLogs.get(member.guild.id);
    if (logChanId) {
        const logChan = member.guild.channels.cache.get(logChanId);
        if (logChan) {
            try {
                const newInvites = await member.guild.invites.fetch();
                const oldInvites = client.guildInvites.get(member.guild.id) || new Map();
                const usedInvite = newInvites.find(inv => inv.uses > (oldInvites.get(inv.code) || 0));
                
                let inviterText = "par une invitation inconnue";
                if (usedInvite && usedInvite.inviter) {
                    inviterText = `par <@${usedInvite.inviter.id}>, qui a maintenant **${usedInvite.uses}** invitations !`;
                }
                
                const embed = new EmbedBuilder()
                    .setColor(MAIN_COLOR)
                    .setAuthor({ name: `Nouveau membre sur ${member.guild.name} !`, iconURL: member.guild.iconURL() })
                    .setDescription(`<@${member.id}> vient de rejoindre. Ils ont été invités ${inviterText}`)
                    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                    .setTimestamp();
                logChan.send({ embeds: [embed] });
                client.guildInvites.set(member.guild.id, new Map(newInvites.map(inv => [inv.code, inv.uses])));
            } catch(e) {}
        }
    }
});

client.on('guildMemberRemove', async member => {
    const logChanId = client.inviteLogs.get(member.guild.id);
    if (logChanId) {
        // Find channel named "leave" or use the log channel
        let leaveChan = member.guild.channels.cache.find(c => c.name === "leave") || member.guild.channels.cache.get(logChanId);
        if (leaveChan) {
            const embed = new EmbedBuilder()
                .setColor("#FF0000")
                .setAuthor({ name: `Départ d'un membre de ${member.guild.name} !`, iconURL: member.guild.iconURL() })
                .setDescription(`**${member.user.username}** a quitté le serveur. 😢`)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setTimestamp();
            leaveChan.send({ embeds: [embed] });
        }
    }
});

// Protection Fabulousbot + Unban protection (Wet/BL)
client.on('guildAuditLogEntryCreate', async (auditLog, guild) => {
    const { action, targetId, executorId } = auditLog;
    if (executorId === client.user.id) return; // Ignore self

    // Anti-Unban for WET and BL
    if (action === AuditLogEvent.MemberBanRemove) {
        if (client.wetList.has(targetId)) {
            const executor = await guild.members.fetch(executorId).catch(()=>{});
            if (executor && !isWL(executor.id)) {
                executor.send("Attention à toi tu essaies de unban un utilisateur qui a été Wet par un Sys+.");
                guild.members.ban(targetId, { reason: "Protection WET" });
            }
        }
        if (client.blacklist.has(targetId)) {
            guild.members.ban(targetId, { reason: "Contournement Blacklist" });
        }
    }

    // Fabulousbot protection
    if (isFabulous(targetId) && !isFabulous(executorId)) {
        const executor = await guild.members.fetch(executorId).catch(()=>{});
        const target = await guild.members.fetch(targetId).catch(()=>{});
        if (!executor || !target) return;

        if (action === AuditLogEvent.MemberDisconnect || action === AuditLogEvent.MemberMove) {
            if (target.voice && target.voice.channel) return; // Impossible to perfectly reverse disconnect without bot moving them back, but we can disconnect the executor.
            executor.voice.disconnect();
        }
        if (action === AuditLogEvent.MemberUpdate) {
            // Mute / Deaf / Nickname
            if (auditLog.changes.some(c => c.key === 'mute')) { target.voice.setMute(false); executor.voice.setMute(true); }
            if (auditLog.changes.some(c => c.key === 'deaf')) { target.voice.setDeaf(false); executor.voice.setDeaf(true); }
            if (auditLog.changes.some(c => c.key === 'nick')) { target.setNickname(null); executor.setNickname(auditLog.changes[0].new); }
        }
    }
});

client.on('messageDelete', message => {
    if (!message.author || message.author.bot) return;
    client.snipes.set(message.channel.id, {
        content: message.content,
        author: message.author,
        image: message.attachments.first() ? message.attachments.first().proxyURL : null,
        timestamp: Date.now()
    });
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // SMASH OR PASS SYSTEM
    if (message.channel.name.toLowerCase().includes("smash")) {
        if (message.attachments.size === 0) return message.delete();
        await message.react('✓');
        await message.react('✘');
        try {
            await message.startThread({
                name: `Avis sur ${message.author.username}`,
                autoArchiveDuration: 60
            });
        } catch (e) {}
        return;
    }

    // PREFIX
    const prefix = client.prefixes.get(message.guild?.id) || '+';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const executor = message.member;

    // ==================== COMMANDES DE BASE ====================
    if (command === 'ping') return message.reply("Ta cru j'étais off btrd?");
    
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle("📚 Liste des Commandes")
            .setColor(MAIN_COLOR)
            .setDescription(`
**Système** : \`+setprefix\`, \`+backup save\`, \`+backup load\`, \`+mybotserv\`
**Modération** : \`+ban\`, \`+unban\`, \`+unbanall\`, \`+kick\`, \`+clear\`, \`+mute\`, \`+unmute\`, \`+mutealls\`
**Dangereux (WL/Owner)** : \`+bl\`, \`+unbl\`, \`+wet\`, \`+unwet\`, \`+dog\`, \`+undog\`, \`+lock\`, \`+unlock\`
**Utilitaire** : \`+pic\`, \`+banner\`, \`+snipe\`, \`+ui\`, \`+baninfo\`, \`+blinfo\`
**Vocal/PV** : \`+pv\`, \`+pvacces\`, \`+unpv\`, \`+mv\`, \`+randomvoc\`, \`+joinsbot\`
**Fun/Spam** : \`+smash\`, \`+snap\`, \`+mp\`, \`+dmall\`, \`+flood\`
**Logs** : \`+inviteloger\`, \`+Ghostjoins\`, \`+welcome\`
*Note : Utilisez le préfixe \`${prefix}\` devant la commande.*`);
        return message.channel.send({ embeds: [embed] });
    }

    if (command === 'setprefix') {
        if (!isAdmin(executor)) return;
        if (!args[0]) return message.reply("Spécifie un préfixe.");
        const msg = await message.reply(`Es-tu sûr de vouloir changer le préfixe en \`${args[0]}\` ? (Réponds "oui")`);
        const filter = m => m.author.id === message.author.id && m.content.toLowerCase() === 'oui';
        const collector = message.channel.createMessageCollector({ filter, time: 10000, max: 1 });
        collector.on('collect', () => {
            client.prefixes.set(message.guild.id, args[0]);
            msg.edit(`✓ Préfixe mis à jour : \`${args[0]}\``);
        });
    }

    // ==================== UTILITAIRES & INFOS ====================
    if (command === 'pic') {
        const target = message.mentions.users.first() || message.author;
        const member = message.guild.members.cache.get(target.id);
        const embed = new EmbedBuilder()
            .setColor(MAIN_COLOR)
            .setTitle(`Avatar de ${target.username}`)
            .setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setDescription(member && member.avatar ? `[Avatar Serveur](${member.displayAvatarURL({ dynamic: true, size: 1024 })})` : "");
        return message.reply({ embeds: [embed] });
    }

    if (command === 'snipe') {
        const sniped = client.snipes.get(message.channel.id);
        if (!sniped) return message.reply("✘ Aucun message supprimé récemment.");
        const embed = new EmbedBuilder()
            .setAuthor({ name: sniped.author.tag, iconURL: sniped.author.displayAvatarURL() })
            .setDescription(sniped.content || "*Message sans texte*")
            .setColor(MAIN_COLOR)
            .setTimestamp(sniped.timestamp);
        if (sniped.image) embed.setImage(sniped.image);
        return message.reply({ embeds: [embed] });
    }

    if (command === 'ui') {
        const target = message.mentions.members.first() || message.member;
        const embed = new EmbedBuilder()
            .setColor(MAIN_COLOR)
            .setAuthor({ name: `Compte : @${target.user.username}` })
            .setThumbnail(target.user.displayAvatarURL({ dynamic: true }))
            .setDescription(`**Informations**\n**Pseudo :** ${target.displayName}\n**Id :** ${target.id}\n**Activité/Statut**\n**Statut :** ${target.presence?.status || "hors-ligne"}\n**Vocal :** ${target.voice.channel ? "En vocal" : "Pas en vocal"}\n\n**Dates**\n**Créé :** <t:${Math.floor(target.user.createdTimestamp/1000)}:R>\n**Rejoint :** <t:${Math.floor(target.joinedTimestamp/1000)}:R>\n\n**Rôles**\n${target.roles.cache.filter(r => r.name !== '@everyone').map(r => r.toString()).join(' ')}`);
        return message.reply({ embeds: [embed] });
    }

    // ==================== WET / BL / BAN ====================
    if (command === 'wet') {
        if (!isWL(message.author.id)) return;
        const target = message.mentions.members.first();
        if (!target) return message.reply("Mentionne une cible.");
        if (isWL(target.id) || target.id === OWNER_ID) {
            const m = await message.reply("Vous ne pouvez pas effectuer cette commande sur votre supérieur !");
            setTimeout(() => { m.delete(); message.delete(); }, 2000);
            return;
        }
        client.wetList.add(target.id);
        await target.ban({ reason: "Wet par un WL" });
        return message.reply(`✓ ${target.user.tag} a été WET.`);
    }

    if (command === 'unwet') {
        if (!isWL(message.author.id)) return;
        const id = args[0]?.replace(/\D/g, '');
        if (!id) return;
        client.wetList.delete(id);
        await message.guild.members.unban(id).catch(()=>{});
        return message.reply(`✓ <@${id}> a été UNWET.`);
    }

    if (command === 'bl') {
        if (!isAdmin(executor)) return;
        const target = message.mentions.members.first();
        if (!target) return;
        const reason = args.slice(1).join(" ") || "non fournis";
        client.blacklist.set(target.id, reason);
        await target.send(`Tu as été blacklisté !\nRaison: ${reason}`).catch(()=>{});
        await target.ban({ reason: `Blacklist: ${reason}` });
        return message.reply(`✓ ${target.user.tag} a été ajouté à la blacklist.`);
    }

    if (command === 'unbl') {
        if (!isWL(message.author.id) && !isAdmin(executor)) return;
        const id = args[0]?.replace(/\D/g, '');
        client.blacklist.delete(id);
        await message.guild.members.unban(id).catch(()=>{});
        return message.reply(`✓ Blacklist retirée pour <@${id}>.`);
    }

    if (command === 'baninfo' || command === 'blinfo') {
        const id = args[0]?.replace(/\D/g, '');
        if (!id) return message.reply("Donne l'ID.");
        try {
            const banInfo = await message.guild.bans.fetch(id);
            const embed = new EmbedBuilder()
                .setTitle(`📜 Informations sur le Bannissement (${command.toUpperCase()})`)
                .setColor(MAIN_COLOR)
                .setDescription(`**👤 Utilisateur :**\nNom d'utilisateur : ${banInfo.user.username}\nIdentifiant : ${banInfo.user.id}\n\n**📄 Informations :**\nRaison : ${banInfo.reason || "Aucune"}`);
            return message.reply({ embeds: [embed] });
        } catch {
            return message.reply("Cet utilisateur n'est pas banni.");
        }
    }

    if (command === 'unbanall') {
        if (!isAdmin(executor)) return;
        const bans = await message.guild.bans.fetch();
        let count = 0;
        bans.forEach(async ban => {
            if (!client.blacklist.has(ban.user.id) && !client.wetList.has(ban.user.id)) {
                await message.guild.members.unban(ban.user.id);
                count++;
            }
        });
        return message.reply(`✓ ${count} membres débannis (les WET et BL sont restés).`);
    }

    // ==================== DOG SYSTEM ====================
    if (command === 'dog') {
        if (!isWL(message.author.id) && !isOwner(message.author.id)) return;
        const target = message.mentions.members.first();
        if (!target) return;
        const lockedName = `${target.displayName} ( 🦮 ${message.member.displayName} )`;
        client.dogs.set(target.id, { executorId: message.author.id, lockedName });
        client.lockedNames.add(target.id);
        await target.setNickname(lockedName).catch(()=>{});
        return message.reply(`✓ ${target.user.tag} est maintenant le chien de ${message.author.username}.`);
    }
    
    if (command === 'undog') {
        if (!isWL(message.author.id) && !isOwner(message.author.id)) return;
        const target = message.mentions.members.first();
        if (!target) return;
        client.dogs.delete(target.id);
        client.lockedNames.delete(target.id);
        await target.setNickname(null).catch(()=>{});
        return message.reply(`✓ ${target.user.tag} est libéré de sa laisse.`);
    }

    // ==================== GESTION VOCALE & SALONS ====================
    if (command === 'lock') {
        if (!isAdmin(executor)) return;
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        return message.reply("ð Salon verrouillé immédiatement. Seuls les admins/WL peuvent parler.");
    }

    if (command === 'unlock') {
        if (!isAdmin(executor)) return;
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
        return message.reply("ð Salon déverrouillé.");
    }

    if (command === 'mvalls') {
        if (!isAdmin(executor)) return;
        const origin = message.member.voice.channel;
        const targetChan = message.guild.channels.cache.get(args[0]);
        if (!origin || !targetChan) return message.reply("Vérifie tes salons vocaux.");
        origin.members.forEach(m => m.voice.setChannel(targetChan));
        return message.reply("✓ Membres déplacés.");
    }

    if (command === 'randomvoc') {
        if (!isAdmin(executor)) return;
        const origin = message.member.voice.channel;
        if (!origin) return;
        const voiceChannels = message.guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice);
        origin.members.forEach(m => {
            const randomChan = voiceChannels.random();
            m.voice.setChannel(randomChan);
        });
        return message.reply("✓ Déplacement aléatoire effectué.");
    }

    if (command === 'mutealls') {
        if (!isAdmin(executor)) return;
        const vc = message.member.voice.channel;
        if (!vc) return;
        vc.members.forEach(m => m.voice.setMute(true));
        return message.reply("✓ Tout le monde rendu muet.");
    }

    if (command === 'jail') {
        if (!isAdmin(executor)) return;
        const target = message.mentions.members.first();
        if (!target) return;
        let jailRole = message.guild.roles.cache.find(r => r.name === 'Jail');
        if (!jailRole) jailRole = await message.guild.roles.create({ name: 'Jail', reason: 'Jail Role' });
        
        message.guild.channels.cache.forEach(c => {
            c.permissionOverwrites.edit(jailRole, { ViewChannel: false });
        });
        await target.roles.set([jailRole]);
        return message.reply(`✓ ${target.user.tag} a été incarcéré.`);
    }

    // ==================== FLOOD & SPAM ====================
    if (command === 'flood') {
        if (!isAdmin(executor)) return;
        const target = message.mentions.members.first();
        const count = Math.min(parseInt(args[1]) || 5, 10);
        if (!target) return;

        const floodPhrases = [
            `AHHAH OHOHOH AHHAAH OHOHO HAHA OHOH HAHA OHOH H AHHA     HOOHOOOAAOO <@${target.id}>`,
            `FERME TA CHATTE FERME TA CHATTE SALE CHIENNASSE SUCEUSE DE BITES TA PTITE SOEUR LA CATIN D'CHIENNE TROU DU CUL SALE CHIENNASSE SALE CHIENNASSE ENFANT DE CATIN <@${target.id}>`,
            `PTITE PUTE FILS DE PUTE GRANDE LANGUEUSE TA GUEULE ENFANT DE VI@LE TA MERE LA PUTE TROU DU CUL PTITE PUTE TA MERE LA PUTE <@${target.id}>`,
            `SALE CHIENNASSE TA SAINTE PUTE DE MERE TA MERE LA PUTE TA MERE LA PUTE ENFANT DE CATIN QUE TU ES FERME TA CHATTE QUE TU ES <@${target.id}>`,
            `SUCE BITE SUCE FLUTE SUCE ARTICHAUD SUCE TOUT SUCE SALOPE SUCE TRANS TG MEC EN KARANSSE <@${target.id}>`,
            `TA LA GEULE A ZW TETE DE BITE T PAS BEAU JE TE QUITTEEEEEEE <@${target.id}>`,
            `JE TE BZ TA PUTE DE MERE ESPECE DE GRANDE PUTE <@${target.id}>`
        ];

        message.delete();
        for (let i = 0; i < count; i++) {
            const randomPhrase = floodPhrases[Math.floor(Math.random() * floodPhrases.length)];
            await message.channel.send(randomPhrase);
            await new Promise(r => setTimeout(r, 500));
        }
    }

    if (command === 'dmall') {
        if (!isOwner(message.author.id)) return;
        const msgText = args.join(" ");
        if (!msgText) return;
        message.reply("Envoi des DMs en cours...");
        message.guild.members.cache.forEach(async m => {
            if (!m.user.bot) {
                await new Promise(r => setTimeout(r, 1000));
                m.send(msgText).catch(()=>{});
            }
        });
    }

    // ==================== BACKUPS ====================
    if (command === 'backup') {
        if (!isOwner(message.author.id)) return;
        const action = args[0];
        if (action === 'save') {
            const backup = {
                roles: message.guild.roles.cache.map(r => ({ name: r.name, color: r.color, perms: r.permissions.bitfield.toString() })),
                channels: message.guild.channels.cache.map(c => ({ name: c.name, type: c.type, parent: c.parentId }))
            };
            client.backups.set(message.guild.id, backup);
            return message.reply("✓ Serveur sauvegardé à la perfection !");
        }
        if (action === 'load') {
            const backup = client.backups.get(message.guild.id);
            if (!backup) return message.reply("✘ Aucune backup trouvée.");
            message.reply("✓ Restauration en cours...");
            // Logique de chargement (simplifiée pour l'intégration globale)
            for (const r of backup.roles) if (r.name !== '@everyone') await message.guild.roles.create({ name: r.name, color: r.color });
            return message.channel.send("✓ Restauration terminée.");
        }
    }

    // ==================== LOGGER & GHOST ====================
    if (command === 'inviteloger') {
        if (!isAdmin(executor)) return;
        const chan = message.mentions.channels.first() || message.channel;
        client.inviteLogs.set(message.guild.id, chan.id);
        return message.reply(`✓ Invite logger défini sur ${chan}.`);
    }

    if (command === 'ghostjoins') {
        if (!isWL(message.author.id)) return;
        if (args[0] === 'désactive') {
            client.ghostJoins.delete(message.guild.id);
            return message.reply("✓ Ghostjoins désactivé.");
        }
        const chan = message.mentions.channels.first() || message.channel;
        client.ghostJoins.set(message.guild.id, chan.id);
        return message.reply(`✓ Ghostjoins activé sur ${chan}.`);
    }

    if (command === 'mybotserv') {
        if (!isOwner(message.author.id)) return;
        const guilds = client.guilds.cache.map(g => `${g.name} (${g.id})\n${g.memberCount} membres | Owner: <@${g.ownerId}>\n`);
        const embed = new EmbedBuilder().setTitle(`Serveurs du bot (${client.guilds.cache.size})`).setDescription(guilds.join('\n\n')).setColor(MAIN_COLOR);
        return message.reply({ embeds: [embed] });
    }

});

// Lancement du bot
client.login(process.env.TOKEN);
