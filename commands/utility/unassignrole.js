const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasRolePermsPermission, getLogChannel } = require('../../utils/role-perms-config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unassignrole')
    .setDescription('Remove a role from a user.')
    .addUserOption(option =>
      option.setName('user').setDescription('The user to remove the role from').setRequired(true)
    )
    .addRoleOption(option =>
      option.setName('role').setDescription('The role to remove').setRequired(true)
    ),

  async execute(interaction, client, config) {
    // Check permissions - use per-guild role perms config
    if (!hasRolePermsPermission(interaction.member, interaction.guild.id)) {
      const errorEmbed = new EmbedBuilder()
        .setDescription('❌ You do not have permissions to run this command. This server must be configured with `/setuproleperms`.')
        .setColor('#FF0000');
      
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('user');
    const role = interaction.options.getRole('role');
    const member = await interaction.guild.members.fetch(user.id);

    if (role.position >= interaction.member.roles.highest.position) {
      const errorEmbed = new EmbedBuilder()
        .setDescription('❌ You cannot remove a role equal or higher than your highest role.')
        .setColor('#FF0000');
      
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }

    await member.roles.remove(role).catch(err => {
      console.error(err);
      const errorEmbed = new EmbedBuilder()
        .setDescription('❌ Failed to remove the role.')
        .setColor('#FF0000');
      
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    });

    // ✅ Public embed response
    const publicEmbed = new EmbedBuilder()
      .setColor('Red')
      .setDescription(`❌ Removed role ${role} from ${user}.`);

    await interaction.reply({ embeds: [publicEmbed] });

    // Log to server-specific log channel if configured
    const logChannelId = getLogChannel(interaction.guild.id);
    if (logChannelId) {
      client.channels.fetch(logChannelId).then(logChannel => {
        if (logChannel) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Role Removed')
            .setColor('Red')
            .addFields(
              { name: 'User', value: `<@${user.id}> (${user.tag})`, inline: false },
              { name: 'Role', value: `${role} (${role.id})`, inline: false },
              { name: 'Removed By', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: false },
            )
            .setTimestamp();

          return logChannel.send({ embeds: [embed] }).catch(() => {});
        }
      }).catch(() => {});
    }
  }
};
