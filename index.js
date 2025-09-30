require('dotenv').config();

const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
});

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
const OWNER_ID = "726063885492158474"; // Remplace par ton ID
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

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
client.antispam = false;
client.antlink = false;
client.antibot = false;
client.antiraid = false;
client.raidlog = false;

// -------------------- Persistence --------------------
function readJSONSafe(p) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }
  catch { return null; }
}
function writeJSONSafe(p, data) { try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch {} }
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
const isAdmin = member => member?.permissions?.has(PermissionsBitField.Flags.Administrator) || false;
const simpleEmbed = (title, desc) => new EmbedBuilder().setTitle(title).setDescription(desc).setColor(MAIN_COLOR);
const sendNoAccess = msg => msg.channel.send({ embeds: [simpleEmbed("❌ Accès refusé", `${msg.author}, tu n'as pas accès à cette commande !`)] }).catch(()=>{});
const isOnCooldown = (map, id, msDuration) => (Date.now() - (map.get(id) || 0)) < msDuration;
const setCooldown = (map, id) => map.set(id, Date.now());

// -------------------- Event: messageCreate --------------------
client.on('messageCreate', async message => {
  try {
    if (message.author.bot) return;

    // anti-spam
    if (client.antispam) {
      const last = client.messageCooldowns.get(message.author.id) || 0;
      if (Date.now() - last < 2000) { try { await message.delete(); } catch {} return; }
      client.messageCooldowns.set(message.author.id, Date.now());
    }

    // anti-link
    if (client.antlink && message.content && /(discord\.gg|http:\/\/|https:\/\/)/i.test(message.content)) {
      try { await message.delete(); } catch {}
      return message.channel.send({ embeds: [simpleEmbed("❌ Lien interdit", `${message.author}, les liens sont interdits !`)] }).catch(()=>{});
    }

    // store snipe
    client.snipes.set(message.channel.id, { content: message.content || "", author: message.author, timestamp: Date.now() });

    if (!message.content.startsWith('+')) return;
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // -------------------- COMMANDS --------------------
    // HELP
    if (command === 'help') {
      if (!isAdmin(message.member) && !isWL(message.author.id) && !isOwner(message.author.id)) return sendNoAccess(message);
      const helpText = [
        "+help, +pic, +banner, +serverpic, +serverbanner",
        "+dog, +undog, +undogall, +doglist",
        "+mv, +permv, +unpermv, +permvlist",
        "+wakeup, +snap",
        "+wl, +unwl, +wlist, +bl, +unbl, +blist, +ban, +unban, +banlist, +unbanall",
        "+wet, +unwet, +wetlist",
        "+lockname, +unlockname, +locknamelist",
        "+limitrole, +unlimitrole",
        "+antispam, +antibot, +antlink, +antiraid, +raidlog",
        "+clear, +addrole, +delrole, +derank",
        "+slowmode, +snipe"
      ].join('\n');
      return message.channel.send({ embeds: [simpleEmbed("Liste des commandes", helpText)] });
    }

    // PIC / BANNER
    if (command === 'pic') {
      const userMember = message.mentions.members.first() || message.member;
      return message.channel.send({ embeds: [simpleEmbed(`Photo de profil de ${userMember.displayName}`, "").setImage(userMember.user.displayAvatarURL({ dynamic: true, size: 1024 }))] });
    }
    if (command === 'banner') {
      (async () => {
        const u = message.mentions.users.first() || message.author;
        const fetched = await client.users.fetch(u.id, { force: true });
        const banner = fetched.bannerURL({ size: 1024 });
        if (!banner) return message.reply("Ce membre n'a pas de bannière !");
        return message.channel.send({ embeds: [simpleEmbed(`Bannière de ${u.tag}`, "").setImage(banner)] });
      })(); return;
    }

    // SERVER PIC / BANNER
    if (command === 'serverpic') {
      if (!isAdmin(message.member) && !isWL(message.author.id) && !isOwner(message.author.id)) return sendNoAccess(message);
      return message.channel.send({ embeds: [simpleEmbed(`${message.guild.name} - icône`, "").setImage(message.guild.iconURL({ dynamic: true, size: 1024 }))] });
    }
    if (command === 'serverbanner') {
      if (!isAdmin(message.member) && !isWL(message.author.id) && !isOwner(message.author.id)) return sendNoAccess(message);
      const banner = message.guild.bannerURL({ size: 1024 });
      if (!banner) return message.reply("Ce serveur n'a pas de bannière !");
      return message.channel.send({ embeds: [simpleEmbed(`${message.guild.name} - bannière`, "").setImage(banner)] });
    }

    // DOG SYSTEM
    if (command === 'dog') {
      if (!isAdmin(message.member) && !isWL(message.author.id) && !isOwner(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member || member.id === message.author.id) return message.reply("❌ Mention invalide !");
      if (client.dogs.has(member.id)) return message.reply("❌ Déjà en laisse !");
      const maxDogs = isAdmin(message.member) ? 10 : 2;
      if ([...client.dogs.values()].filter(m => m === message.author.id).length >= maxDogs) return message.reply(`❌ Max ${maxDogs} dogs !`);
      client.dogs.set(member.id, message.author.id);
      persistAll();
      await member.setNickname(`🦮${message.member.displayName}`).catch(()=>{});
      if (member.voice.channel && message.member.voice.channel) await member.voice.setChannel(message.member.voice.channel).catch(()=>{});
      return message.channel.send(`✅ ${member.displayName} est maintenant en laisse par ${message.member.displayName} !`);
    }
    if (command === 'undog') {
      if (!isAdmin(message.member) && !isWL(message.author.id) && !isOwner(message.author.id)) return sendNoAccess(message);
      const member = message.mentions.members.first();
      if (!member || !client.dogs.has(member.id)) return message.reply("❌ Pas de dog !");
      if (client.dogs.get(member.id) !== message.author.id && !isAdmin(message.member)) return message.reply("❌ Tu n'es pas le maître !");
      client.dogs.delete(member.id); persistAll();
      await member.setNickname(null).catch(()=>{});
      return message.channel.send(`✅ ${member.displayName} libéré !`);
    }
    if (command === 'undogall') { client.dogs.clear(); persistAll(); return message.channel.send("✅ Tous les dogs libérés !"); }
    if (command === 'doglist') { return message.channel.send([...client.dogs.entries()].map(([dog,master])=>`${dog} -> ${master}`).join("\n")||"❌ Aucun dog"); }

    // SNAP
    if (command === 'snap') {
      if (!isAdmin(message.member) && !isWL(message.author.id) && !isOwner(message.author.id)) return sendNoAccess(message);
      const target = message.mentions.members.first(); if(!target) return message.reply("❌ Mentionnez un membre !");
      const executorId = message.author.id; const cdMs = 5*60*1000;
      if(isOnCooldown(client.snapCooldown, executorId, cdMs)) return message.reply(`⏳ Attends ${(cdMs-(Date.now()-client.snapCooldown.get(executorId)))/1000|0}s`);
      for(let i=0;i<5;i++){try{await target.send(`<@${executorId}> te demande ton snap !`).catch(()=>{});}catch{} await new Promise(r=>setTimeout(r,300));}
      client.snapCooldown.set(executorId, Date.now());
      client.snapCount.set(executorId,(client.snapCount.get(executorId)||0)+1);
      return message.channel.send(`📩 ${target.displayName}, ${message.author.tag} t'a demandé ton snap !`);
    }

    // MV
    if(command==='mv') {
      const target=message.mentions.members.first()||(args[0]&&message.guild.members.cache.get(args[0]));
      if(!target||!target.voice.channel||!message.member.voice.channel) return message.reply("❌ Invalid mv");
      if(!isAdmin(message.member)&&!isWL(message.author.id)&&!isOwner(message.author.id)&&!client.permMvUsers.has(message.author.id)) return sendNoAccess(message);
      await target.voice.setChannel(message.member.voice.channel).catch(()=>{});
      return message.channel.send(`✅ ${target.displayName} déplacé !`);
    }
    if(command==='permv') { if(!isAdmin(message.member)&&!isOwner(message.author.id)) return sendNoAccess(message); const t=message.mentions.members.first(); if(!t) return message.reply("❌ Mention"); client.permMvUsers.add(t.id); persistAll(); return message.reply("✅ PermMv ajouté !"); }
    if(command==='unpermv'){ if(!isAdmin(message.member)&&!isOwner(message.author.id)) return sendNoAccess(message); const t=message.mentions.members.first(); if(!t) return message.reply("❌ Mention"); client.permMvUsers.delete(t.id); persistAll(); return message.reply("✅ PermMv retiré !"); }
    if(command==='permvlist'){ return message.channel.send([...client.permMvUsers].join("\n")||"❌ Aucun"); }

    // WL / BL
    if(command==='wl'){ if(!isOwner(message.author.id)) return sendNoAccess(message); const t=message.mentions.members.first(); if(!t) return message.reply("❌ Mention"); client.whitelist.add(t.id); persistAll(); return message.reply("✅ WL ajouté !"); }
    if(command==='unwl'){ if(!isOwner(message.author.id)) return sendNoAccess(message); const t=message.mentions.members.first(); if(!t) return message.reply("❌ Mention"); client.whitelist.delete(t.id); persistAll(); return message.reply("✅ WL retiré !"); }
    if(command==='wlist'){ return message.channel.send([...client.whitelist].join("\n")||"❌ Aucun"); }
    if(command==='bl'){ if(!isOwner(message.author.id)) return sendNoAccess(message); const t=message.mentions.members.first(); if(!t) return message.reply("❌ Mention"); client.blacklist.add(t.id); persistAll(); return message.reply("✅ BL ajouté !"); }
    if(command==='unbl'){ if(!isOwner(message.author.id)) return sendNoAccess(message); const t=message.mentions.members.first(); if(!t) return message.reply("❌ Mention"); client.blacklist.delete(t.id); persistAll(); return message.reply("✅ BL retiré !"); }
    if(command==='blist'){ return message.channel.send([...client.blacklist].join("\n")||"❌ Aucun"); }

    // BAN
    if(command==='ban'){ if(!isAdmin(message.member)&&!isOwner(message.author.id)) return sendNoAccess(message); const t=message.mentions.members.first(); if(!t) return message.reply("❌ Mention"); await t.ban({ reason:`Banni par ${message.author.tag}`}).catch(()=>{}); client.banList.add(t.id); persistAll(); return message.channel.send(`✅ ${t.displayName} banni !`); }
    if(command==='unban'){ if(!isAdmin(message.member)&&!isOwner(message.author.id)) return sendNoAccess(message); const t=args[0]; if(!t) return message.reply("❌ ID requis"); await message.guild.members.unban(t).catch(()=>{}); client.banList.delete(t); persistAll(); return message.channel.send("✅ Unban effectué !"); }
    if(command==='banlist'){ return message.channel.send([...client.banList].join("\n")||"❌ Aucun"); }
    if(command==='unbanall'){ if(!isOwner(message.author.id)) return sendNoAccess(message); client.banList.forEach(async id=>{ await message.guild.members.unban(id).catch(()=>{}); }); client.banList.clear(); persistAll(); return message.channel.send("✅ Tous débannis !"); }

    // LOCK NAME
    if(command==='lockname'){ const t=message.mentions.members.first(); if(!t) return message.reply("❌ Mention"); client.lockedNames.add(t.id); persistAll(); return message.reply("✅ Nom verrouillé"); }
    if(command==='unlockname'){ const t=message.mentions.members.first(); if(!t) return message.reply("❌ Mention"); client.lockedNames.delete(t.id); persistAll(); return message.reply("✅ Nom déverrouillé"); }
    if(command==='locknamelist'){ return message.channel.send([...client.lockedNames].join("\n")||"❌ Aucun"); }

    // LIMIT ROLE
    if(command==='limitrole'){ const t=message.mentions.roles.first(); if(!t) return message.reply("❌ Mention rôle"); client.limitRoles.set(t.id, Date.now()); persistAll(); return message.reply("✅ Rôle limité"); }
    if(command==='unlimitrole'){ const t=message.mentions.roles.first(); if(!t) return message.reply("❌ Mention rôle"); client.limitRoles.delete(t.id); persistAll(); return message.reply("✅ Limite retirée"); }

    // SNIPE
    if(command==='snipe'){ const snipe=client.snipes.get(message.channel.id); if(!snipe) return message.reply("❌ Rien à snipe !"); return message.channel.send(`💬 ${snipe.author.tag}: ${snipe.content}`); }

    // WAKEUP
    if(command==='wakeup'){ if(!isAdmin(message.member)&&!isWL(message.author.id)&&!isOwner(message.author.id)) return sendNoAccess(message); const t=message.mentions.members.first(); if(!t) return message.reply("❌ Mention"); const cd=5*60*1000; if(isOnCooldown(client.wakeupCooldown,message.author.id,cd)) return message.reply("⏳ Cooldown wakeup !"); client.wakeupCooldown.set(message.author.id,Date.now()); t.send("⏰ Wake up!").catch(()=>{}); return message.channel.send("✅ Wakeup envoyé !"); }

    // ANTISPAM / ANTI
    if(['antispam','antibot','antlink','antiraid'].includes(command)) {
      if(!isAdmin(message.member)&&!isOwner(message.author.id)) return sendNoAccess(message);
      const val = args[0]==='on';
      client[command] = val;
      return message.channel.send(`✅ ${command} ${val?'activé':'désactivé'}`);
    }

  } catch (err) { console.log("Error:", err); }
});

// -------------------- Event: guildMemberUpdate (locked names) --------------------
client.on('guildMemberUpdate', (oldMember,newMember)=>{
  if(client.lockedNames.has(newMember.id)&&newMember.nickname!==oldMember.nickname){
    newMember.setNickname(oldMember.nickname).catch(()=>{});
  }
});

// -------------------- Ready --------------------
client.once('ready', () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);
  client.user.setActivity("+help | Gère ton serveur !");
});

// -------------------- Login --------------------
client.login(process.env.TOKEN);
