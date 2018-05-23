// https://webpack.js.org/configuration/

const path = require("path");
const webpack = require('webpack');
//const UglifyJsPlugin = require('uglifyjs-webpack-plugin')

module.exports = {
    //mode: "production",
    mode: "development",
    target: "web",

    entry: "./public/js/index.ts",
    output: {
        filename: "bundle.js",
        path: path.join(__dirname, "public" , "js")
    },

    // Enable sourcemaps for debugging webpack's output.
    devtool: "source-map",

    resolve: {
        // Add '.ts' and '.tsx' as resolvable extensions.
        extensions: [".ts", ".tsx", ".js", ".json"]
    },

    module: {
        rules: [
            // All files with a '.ts' or '.tsx' extension will be handled by 'awesome-typescript-loader'.
            {
                test: /\.tsx?$/,
                //loader: "awesome-typescript-loader?presets[]=configFileName!tsconfig.json" // file not found
                // use babel if we want to compile to ES5: https://gist.github.com/c9s/8e2e621d6cfc4e7f8e778d9a592e7f1b
                //loader: "awesome-typescript-loader"
                loader: "awesome-typescript-loader?configFileName=./public/js/tsconfig.json"
                /*
                include: [
                    path.resolve(__dirname, "public")
                ],
                exclude: [
                    path.resolve(__dirname, "node_modules")
                ]
                */
            },

            // All output '.js' files will have any sourcemaps re-processed by 'source-map-loader'.
            { enforce: "pre", test: /\.js$/, loader: "source-map-loader" }
        ]
    },

    // When importing a module whose path matches one of the following, just
    // assume a corresponding global variable exists and use that instead.
    // This is important because it allows us to avoid bundling all of our
    // dependencies, which allows browsers to cache those libraries between builds.
    externals: {
        //"react": "React",
        //"react-dom": "ReactDOM"
        "jquery": "jQuery",
        "i18next": "i18next",
        "i18next-xhr-backend": "i18next-xhr-backend",
        "eventemitter2": "EventEmitter2",
        "chart.js": "Chart",
        "ace": "Ace",
        "appf": "AppF",
        "appfunc": "AppFunc",
        "hlp": "Hlp",
        "helpersclass": "HelpersClass",
        //"ejson": "EJSON"
        "browserutils": "BrowserUtils"
    },

    plugins: [
        //new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/)
        //new webpack.optimize.UglifyJsPlugin()
    ]
};