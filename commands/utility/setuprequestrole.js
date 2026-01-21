const { SlashCommandBuilder, MessageFlags } = require("discord.js");
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

function saveConfig(config) {
  // Ensure data directory exists
  const dataDir = path.join(__dirname, "../data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(dbPath, JSON.stringify(config, null, 2));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setuprequestrole")
    .setDescription("Configure role request system for this guild.")
    .addChannelOption(option =>
      option.setName("channel")
        .setDescription("Channel where role requests should be sent")
        .setRequired(true)
    )
    .addRoleOption(option =>
      option.setName("approverrole1")
        .setDescription("First role allowed to approve requests")
        .setRequired(true)
    )
    .addRoleOption(option =>
      option.setName("approverrole2")
        .setDescription("Optional approver role")
        .setRequired(false)
    )
    .addRoleOption(option =>
      option.setName("approverrole3")
        .setDescription("Optional approver role")
        .setRequired(false)
    )
    .addChannelOption(option =>
      option.setName("logchannel")
        .setDescription("Channel where approval/denial logs will be sent")
        .setRequired(false)
    ),

  async execute(interaction) {
    // ✅ Restrict command usage to bot owner (from environment variables)
    const ownerId = process.env.OwnerID || process.env.OWNER_ID;
    if (!ownerId || interaction.user.id !== ownerId) {
      return interaction.reply({
        content: "❌ You are not authorized to use this command. Only the bot owner can use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const config = loadConfig();
    const channel = interaction.options.getChannel("channel");
    const logChannel = interaction.options.getChannel("logchannel");
    const roles = [
      interaction.options.getRole("approverrole1"),
      interaction.options.getRole("approverrole2"),
      interaction.options.getRole("approverrole3"),
    ].filter(r => r);

    config[interaction.guild.id] = {
      channelId: channel.id,
      approverRoles: roles.map(r => r.id),
      logChannelId: logChannel ? logChannel.id : null,
    };

    saveConfig(config);

    let responseContent = `✅ Role request system configured.\n**Channel:** ${channel}\n**Approver Roles:** ${roles.map(r => r).join(", ")}`;
    if (logChannel) {
      responseContent += `\n**Log Channel:** ${logChannel}`;
    } else {
      responseContent += `\n**Log Channel:** Not configured (logs will not be sent)`;
    }

    return interaction.reply({
      content: responseContent,
      flags: MessageFlags.Ephemeral,
    });
  },
};
