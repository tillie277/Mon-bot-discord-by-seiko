require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const ms = require("ms");
const path = require("path");

// -------------------- Client --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// -------------------- Config / Constants --------------------
const MAIN_COLOR = "#8A2BE2";
const OWNER_ID = "726063885492158474"; // Remplace par ton ID owner si nécessaire
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// paths for persistence
const PATHS = {
  whitelist: path.join(DATA_DIR, 'whitelist.json'),
  blacklist: path.join(DATA_DIR, 'blacklist.json'),
  wetList: path.join(DATA_DIR, 'wetList.json'),
  banList: path.join(DATA_DIR, 'banList.json'),
  dogs: path.join(DATA_DIR, 'dogs.json'),
  permMv: path.join(DATA_DIR, 'permMv.json'),
  limitRoles: path.join(DATA_DIR, 'limitRoles.json'),
  snapData: path.join(DATA_DIR, 'snapData.json'),
  wakeupData: path.join(DATA_DIR, 'wakeupData.json'),
  lockedNames: path.join(DATA_DIR, 'lockedNames.json')
};

// -------------------- In-memory stores --------------------
client.whitelist = new Set();
client.blacklist = new Set();
client.wetList = new Set();
client.banList = new Set();
client.dogs = new Map();
client.permMvUsers = new Set();
client.limitRoles = new Map();
client.snipes = new Map();
client.messageCooldowns = new Map();
client.snapCooldown = new Map();
client.snapCount = new Map();
client.wakeupCooldown = new Map();
client.wakeupInProgress = new Set();
client.lockedNames = new Set();

// -------------------- Utilitaires persistence --------------------
function readJSONSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error("Erreur lecture JSON", p, e);
    return null;
  }
}
function writeJSONSafe(p, data) {
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Erreur écriture JSON", p, e);
  }
}
function persistAll() {
  writeJSONSafe(PATHS.whitelist, [...client.whitelist]);
  writeJSONSafe(PATHS.blacklist, [...client.blacklist]);
  writeJSONSafe(PATHS.wetList, [...client.wetList]);
  writeJSONSafe(PATHS.banList, [...client.banList]);
  writeJSONSafe(PATHS.dogs, [...client.dogs.entries()]);
  writeJSONSafe(PATHS.permMv, [...client.permMvUsers]);
  writeJSONSafe(PATHS.limitRoles, [...client.limitRoles.entries()]);
  writeJSONSafe(PATHS.lockedNames, [...client.lockedNames]);
}
function loadAll() {
  const wl = readJSONSafe(PATHS.whitelist); if (Array.isArray(wl)) wl.forEach(id => client.whitelist.add(id));
  const bl = readJSONSafe(PATHS.blacklist); if (Array.isArray(bl)) bl.forEach(id => client.blacklist.add(id));
  const wet = readJSONSafe(PATHS.wetList); if (Array.isArray(wet)) wet.forEach(id => client.wetList.add(id));
  const ban = readJSONSafe(PATHS.banList); if (Array.isArray(ban)) ban.forEach(id => client.banList.add(id));
  const dogs = readJSONSafe(PATHS.dogs); if (Array.isArray(dogs)) dogs.forEach(([k,v]) => client.dogs.set(k,v));
  const pmv = readJSONSafe(PATHS.permMv); if (Array.isArray(pmv)) pmv.forEach(id => client.permMvUsers.add(id));
  const lr = readJSONSafe(PATHS.limitRoles); if (Array.isArray(lr)) lr.forEach(([k,v]) => client.limitRoles.set(k,v));
  const ln = readJSONSafe(PATHS.lockedNames); if (Array.isArray(ln)) ln.forEach(id => client.lockedNames.add(id));
}
loadAll();

// -------------------- Permissions helpers --------------------
function isOwner(id) { return id === OWNER_ID; }
function isWL(id) { return client.whitelist.has(id) || isOwner(id); }
function isAdmin(member) {
  if (!member) return false;
  try { return member.permissions.has(PermissionsBitField.Flags.Administrator); } catch { return false; }
}
function sendNoAccess(message) {
  const embed = new EmbedBuilder()
    .setTitle("❌ Accès refusé")
    .setDescription(`${message.author}, tu n'as pas accès à cette commande !`)
    .setColor(MAIN_COLOR);
  return message.channel.send({ embeds: [embed] }).catch(()=>{});
}

// -------------------- Helper Embeds --------------------
function simpleEmbed(title, desc) {
  return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(MAIN_COLOR);
}

// -------------------- Rate-limits / cooldown helpers --------------------
function isOnCooldown(map, id, msDuration) {
  const last = map.get(id) || 0;
  return Date.now() - last < msDuration;
}
function setCooldown(map, id) { map.set(id, Date.now()); }

// -------------------- Command handling --------------------
client.on('messageCreate', async message => {
  try {
    if (message.author.bot) return;

    // anti-spam enforcement
    if (client.antispam) {
      const now = Date.now();
      const last = client.messageCooldowns.get(message.author.id) || 0;
      if (now - last < 2000) {
        try { await message.delete(); } catch {}
        const warn = simpleEmbed("⚠️ Spam détecté", `${message.author}, tu envoies des messages trop vite !`);
        const sent = await message.channel.send({ embeds: [warn] }).catch(()=>null);
        if (sent) setTimeout(() => sent.delete().catch(()=>{}), 3000);
        return;
      }
      client.messageCooldowns.set(message.author.id, now);
    }

    // anti-link enforcement
    if (client.antlink && message.content && (message.content.includes('discord.gg') || message.content.includes('http://') || message.content.includes('https://'))) {
      try { await message.delete(); } catch {}
      const embed = simpleEmbed("❌ Lien interdit", `${message.author}, les liens d'invitation sont interdits !`);
      const sent = await message.channel.send({ embeds: [embed] }).catch(()=>null);
      if (sent) setTimeout(() => sent.delete().catch(()=>{}), 3000);
      return;
    }

    // Store last message for snipe
    client.snipes.set(message.channel.id, { content: message.content || "", author: message.author, timestamp: Date.now() });

    // Commands prefix +
    if (!message.content.startsWith('+')) return;
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // -------------------- PING --------------------
    if (command === 'ping') {
      return message.channel.send("Ta cru j’étais off batard ?");
    }

    // -------------------- HELP --------------------
    if (command === 'help') {
      if (!isAdmin(message.member) && !isWL(message.author.id) && !isOwner(message.author.id)) return sendNoAccess(message);
      const helpText = [
        "+help : Affiche toutes les commandes (admin/WL/owner)",
        "+ping : Test de présence du bot (tous)",
        "+pic @user | +pic : photo de profil (tous)",
        "+banner @user | +banner : bannière (tous)",
        "+serverpic : icône du serveur (admin/WL/owner)",
        "+serverbanner : bannière du serveur (admin/WL/owner)",
        "// DOG system (admin/WL/owner)",
        "+dog @user | +undog @user | +undogall | +doglist",
        "// MOVE / PERM / WAKEUP",
        "+mv @user | +mv userID : déplacer vers TON vocal (admin/WL/owner/permMv users)",
        "+permv @user | +unpermv @user | +permvlist (admin/WL/owner)",
        "+wakeup @user <times> : déplace la cible dans les vocaux <times> fois (max 150) + envoie DM (admin/WL/owner) - cooldown 5min",
        "// SNIPE",
        "+snipe : montre dernier message supprimé (tous) (embed auto-supprimé 3s)",
        "// SNAP",
        "+snap @user : DM la cible 5x \"@exec te demande ton snap\" (admin/WL/owner) - cooldown 5min",
        "// LISTES / MODERATION",
        "+wl @user | +unwl @user | +wlist (owner/WL/admin)",
        "+bl @user | +unbl @user | +blist (admin/WL/owner)",
        "+ban @user | +unban @user | +banlist | +unbanall (admin/owner)",
        "+wet @user | +unwet @user | +wetlist (admin/owner)",
        "// ROLES",
        "+addrole @user roleID | +delrole @user roleID (admin/WL/owner)",
        "+derank @user (admin/WL/owner)",
        "// LIMIT ROLES",
        "+limitrole @role <max> | +unlimitrole @role (admin/owner)",
        "// ANTIS",
        "+antispam | +antibot | +antlink | +antiraid (owner only) | +raidlog (admin/WL/owner)",
        "// MISC",
        "+clear @user <amount> | +clear <amount> : supprime messages (permission ManageMessages)",
        "+slowmode <seconds> (admin/WL/owner)",
      ].join('\n');

      const embed = new EmbedBuilder().setTitle("Liste des commandes").setDescription(helpText).setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] });
    }

    // -------------------- [Toutes les autres commandes comme ton code précédent] --------------------
    // pic, banner, serverpic, serverbanner, dogs, wl/bl/ban/wet, lockname, limitrole, ant toggles, slowmode, snipe, clear, addrole/delrole/derank, snap, mv/permv/wakeup
    // (copie-colle tout ton code précédent ici)

  } catch (err) {
    console.error("Erreur gestion message:", err);
    try { message.reply("❌ Une erreur est survenue lors du traitement de la commande."); } catch {}
  }
});

// -------------------- messageDelete => snipe storage --------------------
client.on('messageDelete', message => {
  if (!message.author || message.author.bot) return;
  client.snipes.set(message.channel.id, { content: message.content || "", author: message.author, timestamp: Date.now() });
});

// -------------------- guildMemberAdd => antibot / blacklist / antiraid --------------------
client.on('guildMemberAdd', async member => {
  try {
    if (client.blacklist.has(member.id)) {
      await member.kick("Membre blacklisté").catch(()=>{});
      return;
    }
    if (client.antibot && member.user.bot) {
      await member.kick("Anti-bot activé").catch(()=>{});
      return;
    }
    if (client.antiraid) {
      const now = Date.now();
      const guildId = member.guild.id;
      if (!client.recentJoins) client.recentJoins = new Map();
      if (!client.recentJoins.has(guildId)) client.recentJoins.set(guildId, []);
      const arr = client.recentJoins.get(guildId);
      arr.push({ id: member.id, timestamp: now });
      const filtered = arr.filter(x => now - x.timestamp < 10000);
      client.recentJoins.set(guildId, filtered);
      if (filtered.length > 3) {
        const members = await member.guild.members.fetch().catch(()=>null);
        const kicked = [];
        if (members) {
          for (const j of filtered) {
            const m = members.get(j.id);
            if (m && !m.permissions.has(PermissionsBitField.Flags.Administrator)) {
              try { await m.kick("Anti-raid : joins massifs détectés"); kicked.push(j.id); } catch {}
            }
          }
        }
        if (client.raidlog && member.guild.systemChannel) {
          const embed = new EmbedBuilder()
            .setTitle("🚨 Anti-raid activé")
            .setDescription(`Des joins massifs ont été détectés. ${kicked.length} comptes ont été kickés automatiquement.`)
            .setColor(MAIN_COLOR)
            .setTimestamp();
          member.guild.systemChannel.send({ embeds: [embed] }).catch(()=>{});
        }
      }
    }
  } catch (e) { console.error("guildMemberAdd error:", e); }
});

// -------------------- guildMemberUpdate => lockname enforcement --------------------
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    if (client.lockedNames && client.lockedNames.has(newMember.id)) {
      if (oldMember.nickname !== newMember.nickname) {
        await newMember.setNickname(oldMember.nickname || newMember.user.username).catch(()=>{});
      }
    }
  } catch(e) {}
});

// -------------------- Bot login --------------------
client.login(process.env.TOKEN_DISCORD).then(()=>console.log("✅ Bot connecté !")).catch(err => console.error("❌ Erreur login bot:", err));
