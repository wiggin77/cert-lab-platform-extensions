/**
 * Webpack config for the plugin's webapp bundle.
 *
 * You do not need to change anything in here.
 *
 * The important part is `externals`. React, Redux and friends are NOT bundled: they are
 * taken from the copies the Mattermost webapp already loaded, at runtime, off `window`.
 * Bundling our own React instead would load a second copy, and two Reacts in one page
 * break hooks with an error that blames your component rather than the build.
 */

const path = require('path');

module.exports = {
    entry: './src/index.tsx',

    resolve: {
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
    },

    module: {
        rules: [
            {
                test: /\.(js|jsx|ts|tsx)$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            ['@babel/preset-env', {targets: {chrome: '90'}}],
                            ['@babel/preset-react', {runtime: 'automatic'}],
                            '@babel/preset-typescript',
                        ],
                    },
                },
            },
        ],
    },

    externals: {
        react: 'React',
        'react-dom': 'ReactDOM',
        redux: 'Redux',
        'react-redux': 'ReactRedux',
        'prop-types': 'PropTypes',
    },

    output: {
        // plugin.json declares this path as webapp.bundle_path. The two have to agree,
        // and a mismatch shows up as a plugin that loads with no webapp at all.
        path: path.resolve(__dirname, 'dist'),
        filename: 'main.js',
    },

    // The bundle is served to a browser from the Mattermost server, so a source map that
    // points at files on the build machine is useless. Inline it or omit it.
    devtool: false,

    performance: {
        // A plugin bundle is loaded after the app, so the default 244 KB warning is noise.
        hints: false,
    },
};
