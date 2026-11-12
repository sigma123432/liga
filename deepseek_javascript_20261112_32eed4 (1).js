const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const config = require('./config.json');

// --- PROSTA BAZA DANYCH (Zapis do pliku JSON) ---
let baza = { gracze: {}, historia: [] };
if (fs.existsSync('./baza.json')) {
  baza = JSON.parse(fs.readFileSync('./baza.json', 'utf8'));
}
function zapiszBaze() {
  fs.writeFileSync('./baza.json', JSON.stringify(baza, null, 2));
}
function pobierzGracza(id, nazwa) {
  if (!baza.gracze[id]) {
    baza.gracze[id] = { nazwa, mmr: 1000, wygrane: 0, przegrane: 0, gry: 0, fairPlay: 0, banned: false };
    zapiszBaze();
  }
  return baza.gracze[id];
}

// --- STAN KOLEJKI ---
let kolejka = [];
let rezerwa = [];
let trybKolejki = 'Normal';

// --- KLIENT BOTA ---
const klient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
});
klient.komendy = new Collection();

// --- DEFINICJE KOMEND ---
const komendyDefinicje = [
  new SlashCommandBuilder().setName('kolejka').setDescription('Zarządzaj kolejką')
    .addSubcommand(sub => sub.setName('start').setDescription('Utwórz nową kolejkę'))
    .addSubcommand(sub => sub.setName('tryb').setDescription('Zmień tryb').addStringOption(o => o.setName('tryb').setDescription('Tryb').setRequired(true).addChoices({name:'Normal',value:'Normal'},{name:'Tryhard',value:'Tryhard'},{name:'ARAM',value:'ARAM'})))
    .addSubcommand(sub => sub.setName('reset').setDescription('Zresetuj kolejkę (admin)')),
  new SlashCommandBuilder().setName('statystyki').setDescription('Statystyki')
    .addSubcommand(sub => sub.setName('profil').setDescription('Twój profil').addUserOption(o => o.setName('gracz').setDescription('Kto').setRequired(false)))
    .addSubcommand(sub => sub.setName('topka').setDescription('Top 10 graczy')),
  new SlashCommandBuilder().setName('admin').setDescription('Panel admina')
    .addSubcommand(sub => sub.setName('ban').setDescription('Zbanuj').addUserOption(o => o.setName('gracz').setDescription('Kto').setRequired(true)))
    .addSubcommand(sub => sub.setName('unban').setDescription('Odbanuj').addUserOption(o => o.setName('gracz').setDescription('Kto').setRequired(true))),
  new SlashCommandBuilder().setName('fun').setDescription('Zabawa')
    .addSubcommand(sub => sub.setName('szpieg').setDescription('Wylosuj szpiega na kanale voice'))
];

// --- REJESTRACJA KOMEND PO STARCIE ---
klient.once('ready', async () => {
  console.log(`🤖 Bot zalogowany jako ${klient.user.tag}`);
  klient.user.setActivity('Customy LoL 🎮', { type: 3 });
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    await rest.put(Routes.applicationCommands(klient.user.id), { body: komendyDefinicje });
    console.log('✅ Komendy zarejestrowane!');
  } catch (e) { console.error(e); }
});

// --- OBSŁUGA INTERAKCJI (KOMENDY I PRZYCISKI) ---
klient.on('interactionCreate', async (interakcja) => {
  if (interakcja.isChatInputCommand()) {
    const sub = interakcja.options.getSubcommand();
    const nazwa = interakcja.commandName;

    // KOLEJKA
    if (nazwa === 'kolejka' && sub === 'start') {
      const embed = new EmbedBuilder().setTitle(`🎯 Kolejka — ${trybKolejki}`).setDescription('**Zapisani (0/10):**\n*Pusto*').setColor(0x5865F2);
      const przyciski = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('join').setLabel('Dołącz').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('leave').setLabel('Wyjdź').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('start').setLabel('Start').setStyle(ButtonStyle.Primary)
      );
      await interakcja.reply({ embeds: [embed], components: [przyciski] });
    }
    if (nazwa === 'kolejka' && sub === 'tryb') {
      trybKolejki = interakcja.options.getString('tryb');
      await interakcja.reply({ content: `✅ Tryb zmieniony na **${trybKolejki}**`, ephemeral: true });
    }
    if (nazwa === 'kolejka' && sub === 'reset') {
      if (!interakcja.member.roles.cache.has(config.rolaAdmina)) return interakcja.reply({ content: '❌ Brak uprawnień!', ephemeral: true });
      kolejka = []; rezerwa = [];
      await interakcja.reply({ content: '♻️ Kolejka zresetowana.', ephemeral: true });
    }

    // STATYSTYKI
    if (nazwa === 'statystyki' && sub === 'profil') {
      const target = interakcja.options.getUser('gracz') || interakcja.user;
      const g = pobierzGracza(target.id, target.username);
      const wr = g.gry > 0 ? ((g.wygrane / g.gry) * 100).toFixed(1) : 0;
      await interakcja.reply({ embeds: [new EmbedBuilder().setTitle(`👤 Profil: ${g.nazwa}`).setColor(0x2ECC71).addFields({name:'MMR',value:`${g.mmr}`,inline:true},{name:'Wygrane',value:`${g.wygrane}`,inline:true},{name:'Przegrane',value:`${g.przegrane}`,inline:true},{name:'Winrate',value:`${wr}%`,inline:true})] });
    }
    if (nazwa === 'statystyki' && sub === 'topka') {
      const posortowani = Object.values(baza.gracze).sort((a, b) => b.mmr - a.mmr).slice(0, 10);
      const lista = posortowani.map((g, i) => `**${i+1}.** ${g.nazwa} — ${g.mmr} MMR`).join('\n') || '*Brak danych*';
      await interakcja.reply({ embeds: [new EmbedBuilder().setTitle('🏆 Top 10').setDescription(lista).setColor(0xF1C40F)] });
    }

    // ADMIN
    if (nazwa === 'admin') {
      if (!interakcja.member.roles.cache.has(config.rolaAdmina)) return interakcja.reply({ content: '❌ Brak uprawnień!', ephemeral: true });
      const target = interakcja.options.getUser('gracz');
      const g = pobierzGracza(target.id, target.username);
      if (sub === 'ban') { g.banned = true; zapiszBaze(); await interakcja.reply({ content: `🔨 Zbanowano ${target.username}.`, ephemeral: true }); }
      if (sub === 'unban') { g.banned = false; zapiszBaze(); await interakcja.reply({ content: `✅ Odbanowano ${target.username}.`, ephemeral: true }); }
    }

    // FUN
    if (nazwa === 'fun' && sub === 'szpieg') {
      const kanalVoice = interakcja.member?.voice?.channel;
      if (!kanalVoice) return interakcja.reply({ content: '❌ Wejdź najpierw na kanał voice!', ephemeral: true });
      const gracze = [...kanalVoice.members.values()].filter(m => !m.user.bot);
      if (gracze.length < 2) return interakcja.reply({ content: '❌ Potrzeba min. 2 graczy na voice!', ephemeral: true });
      const szpieg = gracze[Math.floor(Math.random() * gracze.length)];
      try { await szpieg.send('🕵️ Jesteś SZPIEGIEM! Sabotuj drużynę od środka.'); await interakcja.reply({ content: '🕵️ Szpieg dostał info na priv!', ephemeral: true }); }
      catch { await interakcja.reply({ content: '❌ Szpieg ma wyłączone DM.', ephemeral: true }); }
    }
  }

  // OBSŁUGA PRZYCISKÓW
  if (interakcja.isButton()) {
    if (interakcja.customId === 'join') {
      const g = pobierzGracza(interakcja.user.id, interakcja.user.username);
      if (g.banned) return interakcja.reply({ content: '❌ Jesteś zbanowany!', ephemeral: true });
      if (kolejka.includes(interakcja.user.id)) return interakcja.reply({ content: '⚠️ Już jesteś w kolejce!', ephemeral: true });
      if (kolejka.length >= 10) { rezerwa.push(interakcja.user.id); return interakcja.reply({ content: '📋 Kolejka pełna — jesteś w rezerwie!', ephemeral: true }); }
      kolejka.push(interakcja.user.id);
      await interakcja.reply({ content: `✅ Dołączyłeś (${kolejka.length}/10)`, ephemeral: true });
      odswiezKolejke(interakcja);
    }
    if (interakcja.customId === 'leave') {
      const idx = kolejka.indexOf(interakcja.user.id);
      if (idx === -1) return interakcja.reply({ content: '⚠️ Nie ma Cię w kolejce!', ephemeral: true });
      kolejka.splice(idx, 1);
      if (rezerwa.length > 0) kolejka.push(rezerwa.shift());
      await interakcja.reply({ content: '👋 Wyszedłeś z kolejki.', ephemeral: true });
      odswiezKolejke(interakcja);
    }
    if (interakcja.customId === 'start') {
      if (kolejka.length < 10) return interakcja.reply({ content: `❌ Potrzeba 10 graczy (jest ${kolejka.length})`, ephemeral: true });
      await interakcja.reply({ content: '🎮 Startujemy! Tworzę drużyny...', ephemeral: true });
      startGry(interakcja);
    }
  }
});

// --- FUNKCJE POMOCNICZE ---
async function odswiezKolejke(interakcja) {
  const kanal = await klient.channels.fetch(config.kanalKolejki).catch(() => null);
  if (!kanal) return;
  const lista = kolejka.length ? kolejka.map((id, i) => `${i + 1}. <@${id}>`).join('\n') : '*Pusto*';
  const embed = new EmbedBuilder().setTitle(`🎯 Kolejka — ${trybKolejki}`).setDescription(`**Zapisani (${kolejka.length}/10):**\n${lista}`).setColor(0x5865F2);
  const przyciski = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('join').setLabel('Dołącz').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('leave').setLabel('Wyjdź').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('start').setLabel('Start').setStyle(ButtonStyle.Primary)
  );
  const wiadomosci = await kanal.messages.fetch({ limit: 10 });
  const stara = wiadomosci.find(m => m.author.id === klient.user.id && m.embeds[0]?.title?.includes('Kolejka'));
  if (stara) await stara.edit({ embeds: [embed], components: [przyciski] });
  else await kanal.send({ embeds: [embed], components: [przyciski] });
}

async function startGry(interakcja) {
  const przetasowani = [...kolejka].sort(() => Math.random() - 0.5);
  const d1 = przetasowani.slice(0, 5);
  const d2 = przetasowani.slice(5, 10);
  const kanal = await klient.channels.fetch(config.kanalKolejki);
  
  const embed = new EmbedBuilder().setTitle(`⚔️ Drużyny gotowe — ${trybKolejki}`).setColor(0xE74C3C)
    .addFields({ name: '🔵 Drużyna 1', value: d1.map(id => `<@${id}>`).join('\n'), inline: true }, { name: '🔴 Drużyna 2', value: d2.map(id => `<@${id}>`).join('\n'), inline: true });
  const przyciski = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wynik1').setLabel('Wygrała D1').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('wynik2').setLabel('Wygrała D2').setStyle(ButtonStyle.Danger)
  );
  await kanal.send({ embeds: [embed], components: [przyciski] });

  try {
    const kategoria = await klient.channels.fetch(config.kategoriaVoice);
    const v1 = await interakcja.guild.channels.create({ name: '🔵 Drużyna 1', type: ChannelType.GuildVoice, parent: kategoria.id });
    const v2 = await interakcja.guild.channels.create({ name: '🔴 Drużyna 2', type: ChannelType.GuildVoice, parent: kategoria.id });
    for (const id of d1) { const m = await interakcja.guild.members.fetch(id).catch(() => null); if (m?.voice?.channel) await m.voice.setChannel(v1).catch(() => {}); }
    for (const id of d2) { const m = await interakcja.guild.members.fetch(id).catch(() => null); if (m?.voice?.channel) await m.voice.setChannel(v2).catch(() => {}); }
    
    // Zapisz historię
    baza.historia.push({ data: new Date().toISOString(), d1: d1.map(id => baza.gracze[id].nazwa).join(', '), d2: d2.map(id => baza.gracze[id].nazwa).join(', '), tryb: trybKolejki });
    zapiszBaze();
  } catch (e) { console.error('Błąd voice:', e); }
}

klient.login(config.token);