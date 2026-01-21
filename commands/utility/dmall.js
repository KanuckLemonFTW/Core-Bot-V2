const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dmall')
        .setDescription('DM everyone in the server (bot owner only).')
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('The message to send to everyone')
                .setRequired(true)
        ),

    async execute(interaction, client, config) {
        // Server-only
        if (!interaction.guild) {
            return interaction.reply({
                content: '❌ This command can only be used in a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Bot owner check
        const ownerId = process.env.OwnerID || process.env.OWNER_ID;
        if (!ownerId || interaction.user.id !== ownerId) {
            return interaction.reply({
                content: '❌ You are not authorized to use this command. Only the bot owner can use this command.',
                flags: MessageFlags.Ephemeral
            });
        }

        const message = interaction.options.getString('message');
        const guild = interaction.guild;

        // Defer reply since this might take a while
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // Fetch all members
            const members = await guild.members.fetch();
            const memberList = [...members.values()].filter(m => !m.user.bot); // Exclude bots

            if (memberList.length === 0) {
                return interaction.editReply({
                    content: '❌ No members found to DM (excluding bots).'
                });
            }

            let sent = 0;
            let failed = 0;
            let skipped = 0;
            const failures = [];

            // Batch size for rate limiting (Discord has strict DM rate limits)
            const batchSize = 5;
            const delayMs = 1000; // 1 second delay between batches to avoid rate limits
            let lastProgressEdit = 0;

            for (let i = 0; i < memberList.length; i += batchSize) {
                const batch = memberList.slice(i, i + batchSize);

                await Promise.allSettled(
                    batch.map(async (member) => {
                        try {
                            // Try to send DM
                            await member.send(message);
                            sent++;
                        } catch (err) {
                            // Common errors: DMs disabled, blocked bot, etc.
                            if (err.code === 50007) {
                                // Cannot send messages to this user (DMs disabled)
                                skipped++;
                            } else {
                                failed++;
                                if (failures.length < 10) {
                                    failures.push(`${member.user.tag || member.id}: ${err.message || 'Unknown error'}`);
                                }
                            }
                        }
                    })
                );

                // Progress update every 5 seconds
                const now = Date.now();
                if (now - lastProgressEdit > 5000) {
                    lastProgressEdit = now;
                    const processed = Math.min(i + batchSize, memberList.length);
                    await interaction.editReply({
                        content: `⏳ Sending DMs... **${processed}/${memberList.length}** processed.\n✅ Sent: **${sent}** | ⏭️ Skipped (DMs off): **${skipped}** | ❌ Failed: **${failed}**`
                    }).catch(() => {});
                }

                // Delay between batches to avoid rate limits
                if (i + batchSize < memberList.length) {
                    await sleep(delayMs);
                }
            }

            // Final result embed
            const resultEmbed = new EmbedBuilder()
                .setTitle('✅ /dmall completed')
                .setColor(failed > 0 ? '#FF9900' : '#00AA55')
                .addFields(
                    { name: 'Server', value: `${guild.name}`, inline: false },
                    { name: 'Total members', value: `${memberList.length}`, inline: true },
                    { name: '✅ Sent', value: `${sent}`, inline: true },
                    { name: '⏭️ Skipped (DMs disabled)', value: `${skipped}`, inline: true },
                    { name: '❌ Failed', value: `${failed}`, inline: true },
                )
                .addFields(
                    { name: 'Message sent', value: message.length > 1024 ? message.substring(0, 1021) + '...' : message, inline: false }
                )
                .setTimestamp();

            if (failures.length > 0) {
                resultEmbed.addFields({
                    name: 'First failures (up to 10)',
                    value: clampEmbedFieldValue(failures.join('\n')),
                    inline: false
                });
            }

            return interaction.editReply({ content: null, embeds: [resultEmbed] });

        } catch (error) {
            console.error('Error in /dmall:', error);
            return interaction.editReply({
                content: `❌ An error occurred while processing: ${error.message}`
            });
        }
    }
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function clampEmbedFieldValue(value, maxLen = 1024) {
    const s = (value ?? '').toString();
    if (!s) return 'None';
    if (s.length <= maxLen) return s;
    return s.slice(0, Math.max(0, maxLen - 3)) + '...';
}

