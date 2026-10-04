const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Usiamo le variabili d'ambiente per sicurezza (zero token esposti su GitHub)
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CANALE_LOG_SANZIONI_ID = process.env.CANALE_LOG_SANZIONI_ID;

// Percorso del file JSON per salvare le verifiche permanentemente
const DB_FILE = path.join(__dirname, 'verifiche.json');

// Funzione per caricare le verifiche dal file
function caricaVerifiche() {
    if (!fs.existsSync(DB_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        return {};
    }
}

// Funzione per salvare le verifiche sul file
function salvaVerifiche(dati) {
    fs.writeFileSync(DB_FILE, JSON.stringify(dati, null, 2), 'utf8');
}

// Memoria temporanea per i codici in attesa di conferma nella bio
const pendingVerifications = new Map();

client.once('ready', async () => {
    console.log(`Bot online come ${client.user.tag}!`);

    const commands = [
        new SlashCommandBuilder()
            .setName('verifica')
            .setDescription('Collega il tuo account Roblox tramite la descrizione del profilo'),
        
        new SlashCommandBuilder()
            .setName('sanzione')
            .setDescription('Registra una sanzione o un ban (es. 3h, 5gg, Warning 2)')
            .addUserOption(option => 
                option.setName('utente')
                      .setDescription('L utente Discord da sanzionare')
                      .setRequired(true))
            .addStringOption(option =>
                option.setName('tipo')
                      .setDescription('Tipo di sanzione (es. 1h-15h, 1gg-15gg, Warning 1-5)')
                      .setRequired(true))
            .addStringOption(option =>
                option.setName('motivo')
                      .setDescription('Motivo della sanzione')
                      .setRequired(true))
            .addUserOption(option =>
                option.setName('aiuto_staff')
                      .setDescription('Eventuale aiuto staff presente')
                      .setRequired(false))
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('Comandi Slash registrati con successo!');
    } catch (error) {
        console.error('Errore nella registrazione dei comandi:', error);
    }
});

client.on('interactionCreate', async interaction => {
    
    // 1. Comando /verifica (Apre il Modale)
    if (interaction.isChatInputCommand() && interaction.commandName === 'verifica') {
        const modal = new ModalBuilder()
            .setCustomId('roblox_verify_modal')
            .setTitle('Collegamento Account Roblox');

        const usernameInput = new TextInputBuilder()
            .setCustomId('roblox_username')
            .setLabel('Il tuo Username esatto di Roblox')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Es: NomeUtenteRoblox')
            .setRequired(true);

        const row = new ActionRowBuilder().addComponents(usernameInput);
        modal.addComponents(row);

        await interaction.showModal(modal);
    }

    // 2. Invio del Modale con il nome Roblox (Genera il codice temporaneo)
    else if (interaction.isModalSubmit() && interaction.customId === 'roblox_verify_modal') {
        const robloxUsername = interaction.fields.getTextInputValue('roblox_username');
        const verifyCode = `FRPL-${Math.floor(1000 + Math.random() * 9000)}`;

        pendingVerifications.set(interaction.user.id, { username: robloxUsername, code: verifyCode });

        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle('🔗 Quasi fatto! Ultimo passaggio')
            .setDescription(`Account inserito: **${robloxUsername}**\n\nPer confermare che l'account è tuo:\n1. Vai sul sito di **Roblox** e accedi al tuo profilo.\n2. Modifica la tua **Descrizione (Bio)** aggiungendo questo codice: \`${verifyCode}\`\n3. Torna qui e clicca su **"Conferma Verifica"**.`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_roblox_verify')
                .setLabel('Conferma Verifica')
                .setStyle(ButtonStyle.Success)
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    // 3. Bottone di conferma verifica (Controlla la Bio tramite API pubbliche e salva su JSON)
    else if (interaction.isButton() && interaction.customId === 'confirm_roblox_verify') {
        const data = pendingVerifications.get(interaction.user.id);
        if (!data) {
            return interaction.reply({ content: '❌ Sessione scaduta o non trovata. Esegui di nuovo `/verifica`.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Ricerca ID Roblox tramite username (API Pubblica)
            const userSearch = await axios.post('https://users.roblox.com/v1/users/search', {
                keyword: data.username,
                limit: 10
            });

            const robloxUser = userSearch.data.data.find(u => u.name.toLowerCase() === data.username.toLowerCase());
            if (!robloxUser) {
                return interaction.editReply(`❌ Non ho trovato l'utente Roblox **${data.username}**. Controlla che sia scritto correttamente.`);
            }

            const robloxUserId = robloxUser.id;
            const profileResponse = await axios.get(`https://users.roblox.com/v1/users/${robloxUserId}`);
            const profileDescription = profileResponse.data.description || '';

            // Controllo se il codice è dentro la bio di Roblox
            if (profileDescription.includes(data.code)) {
                pendingVerifications.delete(interaction.user.id);
                
                // Salvataggio permanente su file JSON
                const database = caricaVerifiche();
                database[interaction.user.id] = {
                    robloxUsername: robloxUser.name,
                    robloxUserId: robloxUserId
                };
                salvaVerifiche(database);

                await interaction.editReply({
                    content: `✅ **Account verificato con successo!** Adesso sei collegato a Roblox come **${robloxUser.name}**.\nPuoi rimuovere il codice dalla tua bio di Roblox.`
                });
            } else {
                await interaction.editReply(`❌ Codice \`${data.code}\` non trovato nella descrizione del profilo di **${data.username}**.`);
            }

        } catch (error) {
            console.error(error);
            await interaction.editReply('❌ Errore di comunicazione con i server di Roblox.');
        }
    }

    // 4. Comando /sanzione (Legge dal JSON e invia l'embed con la foto profilo Roblox)
    else if (interaction.isChatInputCommand() && interaction.commandName === 'sanzione') {
        const targetUser = interaction.options.getUser('utente');
        const tipoSanzione = interaction.options.getString('tipo');
        const motivo = interaction.options.getString('motivo');
        const aiutoStaff = interaction.options.getUser('aiuto_staff');
        const staffMember = interaction.user;

        await interaction.deferReply({ ephemeral: true });

        try {
            const database = caricaVerifiche();
            const userInfo = database[targetUser.id];

            let robloxUsername = "Non collegato / Non verificato";
            let avatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png";

            if (userInfo) {
                robloxUsername = userInfo.robloxUsername;
                
                try {
                    const thumbResponse = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userInfo.robloxUserId}&size=150x150&format=Png&isCircular=false`);
                    avatarUrl = thumbResponse.data.data[0]?.imageUrl || avatarUrl;
                } catch (e) {
                    console.error("Errore nel recupero dell'avatar Roblox:", e);
                }
            }

            const embedSanzione = new EmbedBuilder()
                .setColor(0xff4747)
                .setAuthor({ name: `Nuovo Provvedimento: ${tipoSanzione}`, iconURL: avatarUrl })
                .setThumbnail(avatarUrl)
                .addFields(
                    { name: '👤 Utente Sanzionato', value: `<@${targetUser.id}>`, inline: true },
                    { name: '🎮 Nome Roblox', value: `\`${robloxUsername}\``, inline: true },
                    { name: '🆔 ID Discord', value: `\`${targetUser.id}\``, inline: false },
                    { name: '⚖️ Sanzione / Durata', value: `**${tipoSanzione}**`, inline: true },
                    { name: '📝 Motivo', value: motivo, inline: false },
                    { name: '🛡️ Staff', value: `<@${staffMember.id}>`, inline: true },
                    { name: '🤝 Aiuto Staff', value: aiutoStaff ? `<@${aiutoStaff.id}>` : 'Nessuno', inline: true }
                )
                .setTimestamp();

            const logChannel = await client.channels.fetch(CANALE_LOG_SANZIONI_ID);
            if (logChannel) {
                await logChannel.send({ embeds: [embedSanzione] });
                await interaction.editReply({ content: '✅ Sanzione registrata correttamente nel canale log!' });
            } else {
                await interaction.editReply({ content: '❌ Canale log sanzioni non trovato!' });
            }

        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: '❌ Si è verificato un errore durante l invio della sanzione.' });
        }
    }
});

client.login(TOKEN);