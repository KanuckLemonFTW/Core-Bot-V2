const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Displays information about a user.')
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user you want info on')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      return interaction.reply({
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const target = interaction.options.getUser('target');

    let member;
    try {
      member = await interaction.guild.members.fetch(target.id);
    } catch {
      return interaction.reply({
        content: '❌ That user is not a member of this server (or I cannot access their member data).',
        flags: MessageFlags.Ephemeral,
      });
    }

    const roleMentions = member.roles.cache
      .filter(role => role.id !== interaction.guild.id)
      .map(role => role.toString());

    // Embed field values must be <= 1024 characters. Trim the roles list if needed.
    const maxFieldLen = 1024;
    let rolesValue = 'No Roles';
    if (roleMentions.length) {
      let out = '';
      let shown = 0;
      for (const mention of roleMentions) {
        const next = shown === 0 ? mention : `${out}, ${mention}`;
        // Keep a little space for a suffix like " + 10 more"
        if (next.length > maxFieldLen - 20) break;
        out = next;
        shown += 1;
      }

      const remaining = roleMentions.length - shown;
      rolesValue = remaining > 0 ? `${out} + ${remaining} more` : out;

      // Hard safety cap (in case role mention formatting changes)
      if (rolesValue.length > maxFieldLen) {
        rolesValue = rolesValue.slice(0, maxFieldLen - 3) + '...';
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`👤 User Info: ${target.tag}`)
      .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 1024 }))
      .addFields(
        { name: '🆔 User ID', value: target.id, inline: true },
        { name: '🤖 Bot?', value: target.bot ? 'Yes' : 'No', inline: true },
        { name: '📆 Account Created', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:F>`, inline: true },
        { name: '📆 Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`, inline: true },
        { name: '🎭 Roles', value: rolesValue }
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
