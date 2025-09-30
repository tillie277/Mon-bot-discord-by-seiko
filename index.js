require('dotenv').config();
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
client.dogs = new Map(); // dogId -> masterId
client.permMvUsers = new Set();
client.limitRoles = new Map(); // roleId -> max
client.snipes = new Map(); // channelId -> {content, author, timestamp}
client.messageCooldowns = new Map(); 
client.snapCooldown = new Map(); 
client.snapCount = new Map(); 
client.wakeupCooldown = new Map(); 
client.wakeupInProgress = new Set(); 
client.lockedNames = new Set(); 

// -------------------- Utilitaires persistence --------------------
function readJSONSafe(p) {
  try { if (!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error("Erreur lecture JSON", p, e); return null; }
}
function writeJSONSafe(p, data) {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
  catch (e) { console.error("Erreur écriture JSON", p, e); }
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
function simpleEmbed(title, desc) { return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(MAIN_COLOR); }
function isOnCooldown(map, id, msDuration) { const last = map.get(id) || 0; return Date.now() - last < msDuration; }
function setCooldown(map, id) { map.set(id, Date.now()); }

// -------------------- Command handling --------------------
client.on('messageCreate', async message => {
  try {
    if (message.author.bot) return;

    // Anti-spam
    if (client.antispam) {
      const now = Date.now();
      const last = client.messageCooldowns.get(message.author.id) || 0;
      if (now - last < 2000) { try { await message.delete(); } catch {} }
      client.messageCooldowns.set(message.author.id, now);
    }

    // Snipe
    client.snipes.set(message.channel.id, { content: message.content || "", author: message.author, timestamp: Date.now() });

    if (!message.content.startsWith('+')) return;
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // --- commandes simplifiées ici pour l’exemple
    if (command === 'help') return message.channel.send({ embeds: [simpleEmbed("Help", "Toutes les commandes disponibles")] });
    if (command === 'ping') return message.channel.send("Pong !");

  } catch (err) {
    console.error("Erreur gestion message:", err);
    try { message.reply("❌ Une erreur est survenue."); } catch {}
  }
});

// -------------------- ready / shutdown --------------------
client.once('ready', () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  client.user.setActivity("+help", { type: "LISTENING" }).catch(()=>{});
});

process.on('SIGINT', () => { console.log("SIGINT reçu, sauvegarde..."); persistAll(); process.exit(); });
process.on('beforeExit', () => { persistAll(); });

// -------------------- LOGIN --------------------
client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("✅ Bot connecté !"))
  .catch(err => console.error("❌ Erreur de connexion :", err));
