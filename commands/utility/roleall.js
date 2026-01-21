const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roleall')
        .setDescription('Assign a role to everyone in this server (ownership only).')
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('The role to give to everyone')
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

        // Ownership permission (from config.json)
        if (!hasPermission(interaction.member, config?.permissions?.ownership)) {
            return interaction.reply({
                content: '❌ Only ownership can use this command.',
                flags: MessageFlags.Ephemeral
            });
        }

        const guild = interaction.guild;
        const role = interaction.options.getRole('role');

        // Basic role validation
        if (!role || role.id === guild.id) {
            return interaction.reply({
                content: '❌ You cannot use @everyone for `/roleall`.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (role.managed) {
            return interaction.reply({
                content: '❌ That role is managed by an integration/bot and cannot be assigned manually.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Bot permission + hierarchy checks
        const me = await guild.members.fetchMe().catch(() => null);
        if (!me) {
            return interaction.reply({
                content: '❌ Could not verify my permissions in this server.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({
                content: '❌ I need the **Manage Roles** permission to do that.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (role.position >= me.roles.highest.position) {
            return interaction.reply({
                content: '❌ I cannot assign that role because it is **equal to or higher** than my highest role. Move my bot role above it.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const auditReason = clampAuditLogReason(`Roleall by ${interaction.user.tag} (${interaction.user.id})`);

        // Fetch all members
        const members = await guild.members.fetch();
        const memberList = [...members.values()];

        let processed = 0;
        let added = 0;
        let alreadyHad = 0;
        let skippedUnmanageable = 0;
        let failed = 0;
        const failures = [];

        const batchSize = 5; // faster, still reasonably safe
        const delayMs = memberList.length > 1500 ? 100 : 0; // tiny delay only on very large servers
        let lastProgressEdit = 0;

        for (let i = 0; i < memberList.length; i += batchSize) {
            const batch = memberList.slice(i, i + batchSize);

            const results = await Promise.allSettled(
                batch.map(async (m) => {
                    if (m.roles.cache.has(role.id)) {
                        alreadyHad++;
                        return;
                    }

                    // Can't edit members above the bot in role hierarchy
                    if (!m.manageable) {
                        skippedUnmanageable++;
                        return;
                    }

                    try {
                        await m.roles.add(role, auditReason);
                        added++;
                    } catch (err) {
                        failed++;
                        if (failures.length < 10) {
                            failures.push(`${m.user?.tag || m.id}: ${err?.message || 'Unknown error'}`);
                        }
                    }
                })
            );

            // Avoid "unused" warning / keep intent explicit
            void results;

            processed += batch.length;

            const now = Date.now();
            if (now - lastProgressEdit > 5000) {
                lastProgressEdit = now;
                await interaction.editReply({
                    content: `⏳ Working... **${processed}/${memberList.length}** processed.\n✅ Added: **${added}** | ➖ Already had: **${alreadyHad}** | ⛔ Skipped: **${skippedUnmanageable}** | ❌ Failed: **${failed}**`
                }).catch(() => {});
            }

            if (delayMs) await sleep(delayMs);
        }

        const resultEmbed = new EmbedBuilder()
            .setTitle('✅ /roleall completed')
            .setColor(failed > 0 ? '#FF9900' : '#00AA55')
            .addFields(
                { name: 'Server', value: `${guild.name}`, inline: false },
                { name: 'Role', value: `${role} (\`${role.id}\`)`, inline: false },
                { name: 'Members processed', value: `${memberList.length}`, inline: true },
                { name: 'Added', value: `${added}`, inline: true },
                { name: 'Already had', value: `${alreadyHad}`, inline: true },
                { name: 'Skipped (unmanageable)', value: `${skippedUnmanageable}`, inline: true },
                { name: 'Failed', value: `${failed}`, inline: true },
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
    }
};

function hasPermission(member, allowedRoles) {
    if (!allowedRoles || allowedRoles.length === 0) return false;
    return member.roles.cache.some(role => allowedRoles.includes(role.id));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function clampEmbedFieldValue(value, maxLen = 1024) {
    const s = (value ?? '').toString();
    if (!s) return 'None';
    if (s.length <= maxLen) return s;
    return s.slice(0, Math.max(0, maxLen - 3)) + '...';
}

function clampAuditLogReason(value, maxLen = 512) {
    const s = (value ?? '').toString();
    if (!s) return undefined;
    if (s.length <= maxLen) return s;
    return s.slice(0, Math.max(0, maxLen - 3)) + '...';
}


