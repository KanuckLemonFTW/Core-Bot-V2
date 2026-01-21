const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "../../data/roleRequests.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(dbPath, "utf8"));
  } catch {
    return {};
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("requestrole")
    .setDescription("Request a role to be added to you.")
    .setDefaultMemberPermissions(null) // Allow everyone to use this command
    .addRoleOption(option =>
      option.setName("role")
        .setDescription("The role you are requesting")
        .setRequired(true)
    )
    .addUserOption(option =>
      option.setName("approvedby")
        .setDescription("The person who should approve this request")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("note")
        .setDescription("Additional note for the request")
        .setRequired(false)
    ),

  async execute(interaction) {
    const config = loadConfig();
    const guildConfig = config[interaction.guild.id];

    if (!guildConfig) {
      return interaction.reply({
        content: "This server has not set up role requests yet. Use `/setuprequestrole`.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const role = interaction.options.getRole("role");
    const approver = interaction.options.getUser("approvedby");
    const note = interaction.options.getString("note") || "No additional note provided";
    const requester = interaction.user;

    // Check if user already has the role
    const member = interaction.member || await interaction.guild.members.fetch(requester.id).catch(() => null);
    if (member && member.roles.cache.has(role.id)) {
      const errorEmbed = new EmbedBuilder()
        .setDescription(`❌ You already have the role ${role}. You cannot request a role you already possess.`)
        .setColor('#FF0000');
      
      return interaction.reply({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }

    const approveChannel = interaction.guild.channels.cache.get(guildConfig.channelId);
    if (!approveChannel) {
      return interaction.reply({
        content: "The configured approval channel no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Embed for request
    const embed = new EmbedBuilder()
      .setTitle("Role Request")
      .setColor("Purple")
      .addFields(
        { name: "Requester", value: `${requester}` },
        { name: "Approved By", value: `${approver}` },
        { name: "Role", value: `${role} (ID: ${role.id})` },
        { name: "Time", value: new Date().toLocaleString() },
        { name: "Note", value: note }
      )
      .setFooter({ text: "Use the buttons below to approve or deny this request." });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`approvereq_${role.id}_${requester.id}`)
        .setLabel("Approve Role Request")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`denyreq_${role.id}_${requester.id}`)
        .setLabel("Deny Role Request")
        .setStyle(ButtonStyle.Danger)
    );

    await approveChannel.send({
      content: `${approver}`, // Ping approver outside embed
      embeds: [embed],
      components: [buttons],
    });

    await interaction.reply({
      content: `Role request sent to ${approveChannel}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
