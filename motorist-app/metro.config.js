const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../');

const config = getDefaultConfig(projectRoot);

// Watch all files within the workspace root (required for ../shared/* imports)
config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Allow Metro to resolve the shared workspace package by alias
// This is critical for EAS cloud builds where the project root is the app dir
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  shared: path.resolve(workspaceRoot, 'shared'),
};

module.exports = config;
