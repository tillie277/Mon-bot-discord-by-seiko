// index.js — copie/colle complet
require('dotenv').config();
client.login(process.env.TOKEN);
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");
const ms = require("ms");

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
const OWNER_ID = "726063885492158474"; // Owner (bypass cooldowns & restrictions)
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// persistence file paths
const PATHS = {
  whitelist: path.join(DATA_DIR, 'whitelist.json'),
  blacklist: path.join(DATA_DIR, 'blacklist.json'),
  wetList: path.join(DATA_DIR, 'wetList.json'),
  banList: path.join(DATA_DIR, 'banList.json'),
  dogs: path.join(DATA_DIR, 'dogs.json'),
  permMv: path.join(DATA_DIR, 'permMv.json'),
  limitRoles: path.join(DATA_DIR, 'limitRoles.json'),
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

// Toggle flags (persist not required here)
client.antispam = false;
client.antlink = false;
client.antibot = false;
client.antiraid = false;
client.raidlog = false;

// -------------------- Persistence helpers --------------------
function readJSONSafe(p) {
  try { if (!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error("readJSONSafe error", p, e); return null; }
}
function writeJSONSafe(p, data) {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
  catch (e) { console.error("writeJSONSafe error", p, e); }
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

// -------------------- Helpers --------------------
const isOwner = id => id === OWNER_ID;
const isWL = id => client.whitelist.has(id) || isOwner(id);
const isAdmin = member => { try { return !!member && member.permissions.has(PermissionsBitField.Flags.Administrator); } catch { return false; } };
const simpleEmbed = (title, desc) => new EmbedBuilder().setTitle(title).setDescription(desc).setColor(MAIN_COLOR);
const sendNoAccess = msg => msg.channel.send({ embeds: [simpleEmbed("❌ Accès refusé", `${msg.author}, tu n'as pas accès à cette commande !`)] }).catch(()=>{});
const isOnCooldown = (map, id, msDuration) => (Date.now() - (map.get(id) || 0)) < msDuration;
const setCooldown = (map, id) => map.set(id, Date.now());

// Owner bypass helper: returns true if allowed, considering owner has full bypass
function requirePrivileged(msg, roles = []) {
  if (isOwner(msg.author.id)) return true;
  if (isWL(msg.author.id)) return true;
  if (isAdmin(msg.member)) return true;
  return false;
}

// -------------------- Command handling --------------------
client.on('messageCreate', async message => {
  try {
    if (!message || !message.author || message.author.bot) return;
    const content = message.content || "";

    // anti-spam enforcement
    if (client.antispam && !isOwner(message.author.id)) {
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
    if (client.antlink && !isOwner(message.author.id) && /(discord\.gg|http:\/\/|https:\/\/)/i.test(content)) {
      try { await message.delete(); } catch {}
      const embed = simpleEmbed("❌ Lien interdit", `${message.author}, les liens d'invitation sont interdits !`);
      const sent = await message.channel.send({ embeds: [embed] }).catch(()=>null);
      if (sent) setTimeout(() => sent.delete().catch(()=>{}), 3000);
      return;
    }

    // store snipe
    client.snipes.set(message.channel.id, { content: content || "", author: message.author, timestamp: Date.now() });

    // prefix
    if (!content.startsWith('+')) return;
    const args = content.slice(1).trim().split(/ +/).filter(Boolean);
    const command = (args.shift() || "").toLowerCase();

    // ---------- PING ----------
    if (command === 'ping') {
      // everyone can use ping, no cooldown
      return message.channel.send("Ta cru j’étais off btrd ?");
    }

    // ---------- HELP (embed exactly formatted as requested) ----------
    if (command === 'help') {
      // help requested to be accessible to admin/WL/owner in earlier versions — keep that check
      if (!isAdmin(message.member) && !isWL(message.author.id) && !isOwner(message.author.id)) return sendNoAccess(message);

      const helpLines = [
        "Liste des commandes",
        "+help : Affiche toutes les commandes (admin/WL/ owner)",
        "+pic @user | +pic: photo de profil (tous)",
        "ROLES",
        "+addrole @user roleID | +delrole @user roleID (admin/ WL/owner)",
        "+derank @user (admin/WL/owner)",
        "// LIMIT ROLES",
        "+limitrole @role <max> | +unlimitrole @role (admin/ owner)",
        "// ANTIS",
        "+antispam | +antibot | +antlink | +antiraid (owner only) | +raidlog (admin/WL/owner)",
        "// MISC",
        "+clear @user <amount> | +clear <amount> : supprime messages (admin: ManageMessages)",
        "+slowmode <seconds> (admin/WL/owner)",
        "+banner @user | +banner : bannière (tous)",
        "+serverpic : icône du serveur (admin/WL/owner)",
        "+serverbanner : bannière du serveur (admin/WL/ owner)",
        "// DOG system (admin/WL/owner)",
        "+dog @user | +undog @user | +undogall | +doglist",
        "// MOVE / PERM / WAKEUP",
        "+mv @user | +mv userID : déplacer vers TON vocal (admin/WL/owner/permMv users)",
        "+permv @user | +unpermv @user | +permvlist (admin/WL/owner)",
        "+wakeup @user <times> : déplace la cible dans les vocaux <times> fois (max 150) + envoie DM (admin/WL/ owner) - cooldown 5min",
        "// SNIPE",
        "+snipe : montre dernier message supprimé (tous) (embed auto-supprimé 3s)",
        "// SNAP",
        "+snap @user : DM la cible 5x \"@exec te demande ton snap\" (admin/WL/owner) - cooldown 5min",
        "// LISTES / MODERATION",
        "+wl @user | +unwl @user | +wlist (owner/WL/admin)",
        "+bl @user | +unbl @user | +blist (admin/WL/owner)",
        "+ban @user | +unban @user | +banlist | +unbanall (admin/owner)",
        "+wet @user | +unwet @user | +wetlist (admin/owner)",
        "",
        `owner bot : ${OWNER_ID}`
      ].join('\n');

      const embed = new EmbedBuilder()
        .setTitle("Liste des commandes")
        .setDescription(helpLines)
        .setColor(MAIN_COLOR);

      return message.channel.send({ embeds: [embed] });
    }

    // ---------- PIC / BANNER ----------
    if (command === 'pic') {
      const userMember = message.mentions.members.first() || message.member;
      const embed = new EmbedBuilder()
        .setTitle(`Photo de profil de ${userMember.displayName}`)
        .setImage(userMember.user.displayAvatarURL({ dynamic: true, size: 1024 }))
        .setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }

    if (command === 'banner') {
      (async () => {
        const u = message.mentions.users.first() || message.author;
        try {
          const fetched = await client.users.fetch(u.id, { force: true });
          const banner = fetched.bannerURL({ size: 1024 });
          if (!banner) return message.reply("Ce membre n'a pas de bannière !");
          const embed = new EmbedBuilder().setTitle(`Bannière de ${u.tag}`).setImage(banner).setColor(MAIN_COLOR);
          return message.channel.send({ embeds: [embed] });
        } catch (e) {
          console.error("banner error:", e);
          return message.reply("Erreur lors de la récupération de la bannière.");
        }
      })();
      return;
    }

    // ---------- SERVER PIC / SERVER BANNER ----------
    if (command === 'serverpic') {
      if (!isAdmin(message.member) && !isWL(message.author.id) && !isOwner(message.author.id)) return sendNoAccess(message);
      const icon = message.guild.iconURL({ dynamic: true, size: 1024 });
      const embed = new EmbedBuilder().setTitle(`${message.guild.name} - icône`).setImage(icon).setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }

    if (command === 'serverbanner') {
      if (!isAdmin(message.member) && !isWL(message.author.id) && !isOwner(message.author.id)) return sendNoAccess(message);
      const banner = message.guild.bannerURL({ size: 1024 });
      if (!banner) return message.reply("Ce serveur n'a pas de bannière !");
      const embed = new EmbedBuilder().setTitle(`${message.guild.name} - bannière`).setImage(banner).setColor(MAIN_COLOR);
      return message.channel.send({ embeds: [embed] }).catch(()=>{});
    }

    // ---------- DOG SYSTEM ----------
    if (command === 'dog') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      if (member.id === message.author.id) return message.reply("❌ Tu ne peux pas te mettre toi-même en dog !");
      if (client.dogs.has(member.id)) return message.reply("❌ Ce membre est déjà en laisse !");
      const dogsOfMaster = [...client.dogs.values()].filter(m => m === message.author.id);
      const maxDogs = isAdmin(message.member) ? 10 : 2;
      if (dogsOfMaster.length >= maxDogs) return message.reply(`❌ Tu ne peux pas avoir plus de ${maxDogs} dogs !`);
      client.dogs.set(member.id, message.author.id);
      persistAll();
      try { await member.setNickname(`🦮${message.member.displayName}`).catch(()=>{}); } catch {}
      try { if (member.voice.channel && message.member.voice.channel) await member.voice.setChannel(message.member.voice.channel).catch(()=>{}); } catch {}
      return message.channel.send(`✅ ${member.displayName} est maintenant en laisse par ${message.member.displayName} !`);
    }

    if (command === 'undog') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      if (!client.dogs.has(member.id)) return message.reply("❌ Ce membre n'est pas en laisse !");
      if (client.dogs.get(member.id) !== message.author.id && !isAdmin(message.member) && !isOwner(message.author.id)) return message.reply("❌ Tu n'es pas le maître de ce dog !");
      client.dogs.delete(member.id);
      persistAll();
      member.setNickname(null).catch(()=>{});
      return message.channel.send(`✅ ${member.displayName} a été libéré par ${message.member.displayName} !`);
    }

    if (command === 'undogall') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      client.dogs.forEach((masterId, dogId) => {
        const dog = message.guild.members.cache.get(dogId);
        if (dog) dog.setNickname(null).catch(()=>{});
      });
      client.dogs.clear();
      persistAll();
      return message.channel.send("✅ Tous les dogs ont été libérés !");
    }

    if (command === 'doglist') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      if (client.dogs.size === 0) return message.reply("❌ Aucun dog enregistré !");
      const list = [...client.dogs.entries()].map(([dogId, masterId]) => {
        const dog = message.guild.members.cache.get(dogId);
        const master = message.guild.members.cache.get(masterId);
        return `${dog ? dog.displayName : dogId} -> ${master ? master.displayName : masterId}`;
      }).join("\n");
      return message.channel.send(`🦮 Liste des dogs :\n${list}`);
    }

    // ---------- WL / UNWL / WLIST ----------
    if (command === 'wl') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.whitelist.add(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.displayName} ajouté à la whitelist !`);
    }
    if (command === 'unwl') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.whitelist.delete(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.displayName} retiré de la whitelist !`);
    }
    if (command === 'wlist') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      if (client.whitelist.size === 0) return message.reply("❌ La whitelist est vide !");
      const list = [...client.whitelist].map(id => {
        const m = message.guild.members.cache.get(id);
        return m ? m.displayName : id;
      }).join("\n");
      return message.channel.send(`✅ Membres whitelist :\n${list}`);
    }

    // ---------- BLACKLIST ----------
    if (command === 'bl') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.blacklist.add(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.user.tag} ajouté à la blacklist !`);
    }
    if (command === 'unbl') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.blacklist.delete(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.user.tag} retiré de la blacklist !`);
    }
    if (command === 'blist') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      if (client.blacklist.size === 0) return message.reply("❌ La blacklist est vide !");
      const list = [...client.blacklist].map(id => {
        const m = message.guild.members.cache.get(id);
        return m ? m.user.tag : id;
      }).join("\n");
      return message.channel.send(`❌ Membres blacklist :\n${list}`);
    }

    // ---------- BAN / UNBAN / BANLIST / UNBANALL ----------
    if (command === 'ban') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.banList.add(member.id);
      persistAll();
      member.ban({ reason: "Ban command" }).catch(()=>{});
      return message.channel.send(`✅ ${member.user.tag} a été banni !`);
    }
    if (command === 'unban') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const user = message.mentions.users.first();
      if (!user) return message.reply("❌ Mentionnez un membre !");
      client.banList.delete(user.id);
      persistAll();
      message.guild.members.unban(user.id).catch(()=>{});
      return message.channel.send(`✅ ${user.tag} a été débanni !`);
    }
    if (command === 'banlist') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      if (client.banList.size === 0) return message.reply("❌ Aucun membre banni !");
      const list = [...client.banList].map(id => {
        const u = client.users.cache.get(id);
        return u ? u.tag : id;
      }).join("\n");
      return message.channel.send(`⚠️ Liste des bannis :\n${list}`);
    }
    if (command === 'unbanall') {
      if (!isOwner(message.author.id)) return sendNoAccess(message);
      for (const id of [...client.banList]) {
        try { await message.guild.members.unban(id); } catch {}
        client.banList.delete(id);
      }
      persistAll();
      return message.channel.send("✅ Tous les membres de la banList ont été débannis (tentative).");
    }

    // ---------- WET ----------
    if (command === 'wet') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      if (client.wetList.has(member.id)) return message.reply("❌ Ce membre est déjà wet !");
      client.wetList.add(member.id);
      persistAll();
      member.ban({ reason: "Wet ban" }).catch(()=>{});
      return message.channel.send(`⚠️ ${member.user.tag} a été wet (banni) !`);
    }
    if (command === 'unwet') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const user = message.mentions.users.first();
      if (!user) return message.reply("❌ Mentionnez un membre !");
      if (!client.wetList.has(user.id)) return message.reply("❌ Ce membre n'a pas été wet !");
      client.wetList.delete(user.id);
      persistAll();
      message.guild.members.unban(user.id).catch(()=>{});
      return message.channel.send(`✅ ${user.tag} a été dé-wet !`);
    }
    if (command === 'wetlist') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      if (client.wetList.size === 0) return message.reply("❌ Aucun membre wet !");
      const list = [...client.wetList].map(id => {
        const u = client.users.cache.get(id);
        return u ? u.tag : id;
      }).join("\n");
      return message.channel.send(`⚠️ Membres wet :\n${list}`);
    }

    // ---------- LOCKNAME ----------
    if (command === 'lockname') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.lockedNames.add(member.id);
      persistAll();
      return message.channel.send(`🔒 Le pseudo de ${member.displayName} est maintenant verrouillé !`);
    }
    if (command === 'unlockname') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.lockedNames.delete(member.id);
      persistAll();
      return message.channel.send(`🔓 Le pseudo de ${member.displayName} est maintenant déverrouillé !`);
    }
    if (command === 'locknamelist') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      if (client.lockedNames.size === 0) return message.reply("❌ Aucun pseudo n'est verrouillé !");
      const list = [...client.lockedNames].map(id => {
        const m = message.guild.members.cache.get(id);
        return m ? m.displayName : id;
      }).join("\n");
      return message.channel.send(`🔒 Pseudos verrouillés :\n${list}`);
    }

    // ---------- LIMIT ROLE ----------
    if (command === 'limitrole') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const role = message.mentions.roles.first();
      const max = parseInt(args[0] || args[1]);
      if (!role || isNaN(max) || max < 1) return message.reply("❌ Usage: +limitrole @role <max>");
      client.limitRoles.set(role.id, max);
      persistAll();
      return message.channel.send(`✅ Limite du rôle ${role.name} définie à ${max} membres !`);
    }
    if (command === 'unlimitrole') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const role = message.mentions.roles.first();
      if (!role) return message.reply("❌ Usage: +unlimitrole @role");
      client.limitRoles.delete(role.id);
      persistAll();
      return message.channel.send(`✅ Limite du rôle ${role.name} supprimée !`);
    }

    // ---------- ANT TOGGLES ----------
    if (command === 'antibot' || command === 'antispam' || command === 'antlink' || command === 'antiraid' || command === 'raidlog') {
      // antiraid is owner-only
      if (command === 'antiraid' && !isOwner(message.author.id)) return sendNoAccess(message);
      if (!requirePrivileged(message)) return sendNoAccess(message);
      client[command] = !client[command];
      return message.channel.send(`✅ ${command} ${client[command] ? "activé" : "désactivé"} !`);
    }

    // ---------- SLOWMODE ----------
    if (command === 'slowmode') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const seconds = parseInt(args[0]);
      if (isNaN(seconds) || seconds < 0 || seconds > 21600) return message.reply("❌ Donne un nombre entre 0 et 21600 (secondes).");
      message.channel.setRateLimitPerUser(seconds).then(() => {
        message.channel.send(`✅ Slowmode défini à ${seconds}s pour ce salon.`).then(m => setTimeout(() => m.delete().catch(()=>{}), 5000));
      }).catch(() => message.reply("❌ Impossible de modifier le slowmode (vérifie mes permissions)."));
      return;
    }

    // ---------- SNIPE ----------
    if (command === 'snipe') {
      const snipe = client.snipes.get(message.channel.id);
      if (!snipe) return message.reply("❌ Aucun message à snipe !");
      const date = new Date(snipe.timestamp || Date.now());
      const embed = new EmbedBuilder()
        .setAuthor({ name: snipe.author.tag, iconURL: snipe.author.displayAvatarURL({ dynamic: true }) })
        .setDescription(snipe.content)
        .addFields({ name: "Supprimé le", value: `${date.toLocaleString()}`, inline: true })
        .setColor(MAIN_COLOR);
      const sent = await message.channel.send({ embeds: [embed] }).catch(()=>null);
      if (sent) setTimeout(() => sent.delete().catch(()=>{}), 3000);
      return;
    }

    // ---------- CLEAR ----------
    if (command === 'clear') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages) && !isOwner(message.author.id)) return sendNoAccess(message);
      let target = message.mentions.users.first();
      let amount = 0;
      if (target) {
        amount = parseInt(args[1]) || parseInt(args[0]) || 50;
      } else {
        const possibleId = args[0];
        if (possibleId && /^\d{17,19}$/.test(possibleId)) {
          target = await client.users.fetch(possibleId).catch(()=>null);
          amount = parseInt(args[1]) || 50;
        } else {
          amount = parseInt(args[0]) || 50;
        }
      }
      if (amount < 1 || amount > 100) return message.reply("❌ Donne un nombre entre 1 et 100 !");
      try {
        const fetched = await message.channel.messages.fetch({ limit: 100 });
        let messagesToDelete;
        if (target) {
          messagesToDelete = fetched.filter(m => m.author.id === target.id).first(amount);
        } else {
          messagesToDelete = fetched.first(amount);
        }
        await message.channel.bulkDelete(messagesToDelete, true);
        const info = await message.channel.send({ embeds: [simpleEmbed("✅ Messages supprimés", `${target ? `${amount} messages de ${target.tag} supprimés` : `${amount} messages supprimés`}`)] });
        setTimeout(() => info.delete().catch(()=>{}), 3000);
      } catch (err) {
        console.error("clear error:", err);
        message.channel.send("❌ Une erreur est survenue lors de la suppression des messages.");
      }
      return;
    }

    // ---------- ADDROLE / DELROLE / DERANK ----------
    if (command === 'addrole') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      const roleId = args[1] || args[0];
      const role = message.guild.roles.cache.get(roleId) || message.mentions.roles.first();
      if (!member || !role) return message.reply("Usage: +addrole @user <roleID>");
      const limit = client.limitRoles.get(role.id);
      if (limit && role.members.size >= limit) return message.reply(`❌ Le rôle ${role.name} a atteint sa limite (${limit}).`);
      member.roles.add(role).catch(() => message.reply("❌ Impossible d'ajouter le rôle (vérifie mes permissions)."));
      return message.channel.send(`✅ ${member.user.tag} a reçu le rôle ${role.name}`);
    }
    if (command === 'delrole') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      const roleId = args[1] || args[0];
      const role = message.guild.roles.cache.get(roleId) || message.mentions.roles.first();
      if (!member || !role) return message.reply("Usage: +delrole @user <roleID>");
      member.roles.remove(role).catch(()=>message.reply("❌ Impossible de retirer le rôle (vérifie mes permissions)."));
      return message.reply(`${member.user.tag} a perdu le rôle ${role.name}`);
    }
    if (command === 'derank') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      await member.roles.set([]).catch(()=>message.channel.send("❌ Impossible de modifier les rôles."));
      return message.channel.send(`✅ ${member.user.tag} a été déranké !`);
    }

    // ---------- SNAP ----------
    if (command === 'snap') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const target = message.mentions.members.first();
      if (!target) return message.reply("❌ Mentionnez un membre !");
      const executorId = message.author.id;
      const cooldownMs = 5 * 60 * 1000; // 5 minutes
      if (!isOwner(executorId) && isOnCooldown(client.snapCooldown, executorId, cooldownMs)) {
        const remain = Math.ceil((cooldownMs - (Date.now() - (client.snapCooldown.get(executorId) || 0))) / 1000);
        return message.reply(`⏳ Attends ${remain} secondes avant de refaire +snap !`);
      }
      for (let i = 0; i < 5; i++) {
        try { await target.send(`<@${executorId}> te demande ton snap !`).catch(()=>{}); } catch {}
        await new Promise(res => setTimeout(res, 300));
      }
      if (!isOwner(executorId)) client.snapCooldown.set(executorId, Date.now());
      client.snapCount.set(executorId, (client.snapCount.get(executorId) || 0) + 1);
      return message.channel.send(`📩 ${target.displayName}, ${message.author.tag} t'a demandé ton snap (DM envoyé).`);
    }

    // ---------- MV / PERMV / UNPERMV / PERMVLIST ----------
    if (command === 'mv') {
      const target = message.mentions.members.first() || (args[0] && message.guild.members.cache.get(args[0]));
      if (!target) return message.reply("❌ Membre introuvable !");
      if (!target.voice.channel) return message.reply("❌ Cet utilisateur n'est pas en vocal !");
      if (!message.member.voice.channel) return message.reply("❌ Tu dois être en vocal !");
      if (!isOwner(message.author.id) && !isAdmin(message.member) && !isWL(message.author.id) && !client.permMvUsers.has(message.author.id)) return sendNoAccess(message);
      await target.voice.setChannel(message.member.voice.channel).catch(()=>{});
      return message.channel.send(`✅ ${target.displayName} déplacé dans ton channel vocal !`);
    }
    if (command === 'permv') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.permMvUsers.add(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.displayName} peut désormais utiliser +mv !`);
    }
    if (command === 'unpermv') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member) return message.reply("❌ Mentionnez un membre !");
      client.permMvUsers.delete(member.id);
      persistAll();
      return message.channel.send(`✅ ${member.displayName} ne peut plus utiliser +mv !`);
    }
    if (command === 'permvlist' || command === 'permmvlist' || command === 'permmv') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      if (client.permMvUsers.size === 0) return message.reply("❌ Aucun membre autorisé à +mv !");
      const list = [...client.permMvUsers].map(id => {
        const m = message.guild.members.cache.get(id);
        return m ? m.displayName : id;
      }).join("\n");
      return message.channel.send(`✅ Membres autorisés à +mv :\n${list}`);
    }

    // ---------- WAKEUP ----------
    if (command === 'wakeup') {
      if (!requirePrivileged(message)) return sendNoAccess(message);
      const target = message.mentions.members.first() || (args[0] && message.guild.members.cache.get(args[0]));
      let times = parseInt(args[1] || args[0 + 1]) || 0;
      if (!target) return message.reply("❌ Mentionnez un membre !");
      if (!target.voice.channel) return message.reply("❌ Cet utilisateur n'est pas en vocal !");
      if (!times || times < 1) return message.reply("❌ Donne un nombre de réveils entre 1 et 150 !");
      times = Math.min(times, 150);
      const executorId = message.author.id;
      const cooldownMs = 5 * 60 * 1000;
      if (!isOwner(executorId) && isOnCooldown(client.wakeupCooldown, executorId, cooldownMs)) {
        const remain = Math.ceil((cooldownMs - (Date.now() - (client.wakeupCooldown.get(executorId) || 0))) / 1000);
        return message.reply(`⏳ Attends ${remain} secondes avant de refaire +wakeup !`);
      }
      if (client.wakeupInProgress.has(target.id)) return message.reply("❌ Un wakeup est déjà en cours pour cette cible.");
      client.wakeupInProgress.add(target.id);
      if (!isOwner(executorId)) client.wakeupCooldown.set(executorId, Date.now());
      // get voice channels (GuildVoice)
      const voiceChannels = message.guild.channels.cache.filter(c => c.type === 2 && c.viewable && c.joinable).map(c => c);
      if (voiceChannels.length < 1) {
        client.wakeupInProgress.delete(target.id);
        return message.reply("❌ Aucun channel vocal disponible pour faire le wakeup.");
      }
      const delayMs = 600;
      let moved = 0;
      try {
        for (let i = 0; i < times; i++) {
          const ch = voiceChannels[i % voiceChannels.length];
          try { await target.voice.setChannel(ch).catch(()=>{}); } catch (e) {}
          moved++;
          await new Promise(res => setTimeout(res, delayMs));
        }
      } catch (err) {
        console.error("wakeup moves error:", err);
      } finally {
        client.wakeupInProgress.delete(target.id);
      }
      const dmMessage = `<@${executorId}> t'ordonne de te réveiller !`;
      (async () => {
        for (let i = 0; i < times; i++) {
          try { await target.send(dmMessage).catch(()=>{}); } catch {}
          await new Promise(res => setTimeout(res, 500));
        }
      })();
      return message.channel.send(`✅ ${target.displayName} a été réveillé ${moved} fois (max demandé ${times}). DM(s) envoyé(s).`);
    }

    // Unknown command -> ignore silently
    return;

  } catch (err) {
    console.error("Erreur gestion message:", err);
    try { message.reply("❌ Une erreur est survenue lors du traitement de la commande."); } catch {}
  }
});

// -------------------- messageDelete => snipe storage --------------------
client.on('messageDelete', message => {
  if (!message || !message.author || message.author.bot) return;
  client.snipes.set(message.channel.id, { content: message.content || "", author: message.author, timestamp: Date.now() });
});

// -------------------- guildMemberAdd => antibot / blacklist / antiraid minimal handling --------------------
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
  } catch(e) { console.error("guildMemberUpdate error:", e); }
});

// -------------------- voiceStateUpdate => dogs follow master --------------------
client.on('voiceStateUpdate', (oldState, newState) => {
  try {
    if (!newState || !newState.guild) return;
    client.dogs.forEach((masterId, dogId) => {
      const master = newState.guild.members.cache.get(masterId);
      const dog = newState.guild.members.cache.get(dogId);
      if (!master || !dog) return;
      // If master moved, move dog
      if (newState.member.id === masterId && newState.channelId) {
        if (dog.voice.channelId !== newState.channelId) dog.voice.setChannel(newState.channelId).catch(()=>{});
      }
      // dog moved -> try to bring back to master
      if (newState.member.id === dogId && master.voice.channelId && dog.voice.channelId !== master.voice.channelId) {
        dog.voice.setChannel(master.voice.channelId).catch(()=>{});
      }
    });
  } catch (e) { console.error("voiceStateUpdate dogs error:", e); }
});

// -------------------- READY --------------------
client.once('ready', () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  try { client.user.setActivity("+help", { type: "LISTENING" }).catch(()=>{}); } catch {}
});

// -------------------- Graceful shutdown to persist data --------------------
process.on('SIGINT', () => { console.log("SIGINT reçu, sauvegarde des données..."); persistAll(); process.exit(); });
process.on('beforeExit', () => { persistAll(); });

// -------------------- LOGIN --------------------
const token = process.env.TOKEN || process.env.TOKEN_DISCORD || process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ Aucun token trouvé dans process.env.TOKEN (ou TOKEN_DISCORD / DISCORD_TOKEN). Ajoute ton token via Render Secret Files.");
  process.exit(1);
}
client.login(token).then(() => console.log("✅ Bot login success.")).catch(err => console.error("❌ Erreur de connexion :", err));
