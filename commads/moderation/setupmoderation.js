const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../../data/moderation_config.json');

function loadConfig() {
    try {
        if (!fs.existsSync(configPath)) {
            fs.writeFileSync(configPath, JSON.stringify({}, null, 2));
        }
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        console.error('Error loading moderation config:', error);
        return {};
    }
}

function saveConfig(config) {
    try {
        const dataDir = path.dirname(configPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('Error saving moderation config:', error);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setupmoderation')
        .setDescription('Configure moderation roles and log channel for this server')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role that can use moderation commands')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('logchannel')
                .setDescription('Channel where moderation logs will be sent')
                .setRequired(true)),
    async execute(interaction, client, config) {
        const member = interaction.member;
        const role = interaction.options.getRole('role');
        const logChannel = interaction.options.getChannel('logchannel');

        // Restrict command usage to bot owner (from environment variables)
        const ownerId = process.env.OwnerID || process.env.OWNER_ID;
        if (!ownerId || interaction.user.id !== ownerId) {
            return interaction.reply({
                content: '❌ You are not authorized to use this command. Only the bot owner can use this command.',
                flags: MessageFlags.Ephemeral,
            });
        }

        // Check if channel is a text channel
        if (!logChannel.isTextBased()) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ The log channel must be a text channel.')
                .setColor('#FF0000');
            
            return interaction.reply({ 
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const moderationConfig = loadConfig();
            
            // Initialize guild config if it doesn't exist
            if (!moderationConfig[interaction.guild.id]) {
                moderationConfig[interaction.guild.id] = {
                    roles: [],
                    logChannelId: null
                };
            }
            
            // Add role if not already present
            if (!moderationConfig[interaction.guild.id].roles.includes(role.id)) {
                moderationConfig[interaction.guild.id].roles.push(role.id);
            }
            
            // Update log channel
            moderationConfig[interaction.guild.id].logChannelId = logChannel.id;
            
            saveConfig(moderationConfig);

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Moderation Configuration Updated')
                .setDescription(`Moderation settings have been configured for this server.`)
                .addFields(
                    { name: 'Moderation Role', value: `${role}`, inline: true },
                    { name: 'Log Channel', value: `${logChannel}`, inline: true },
                    { name: 'Total Roles', value: `${moderationConfig[interaction.guild.id].roles.length}`, inline: true }
                )
                .setColor('#00FF00')
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (error) {
            console.error('Error setting up moderation:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription(`Failed to configure moderation: ${error.message}`)
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};
