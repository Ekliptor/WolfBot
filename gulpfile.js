const gulp = require('gulp');
const typedoc = require("gulp-typedoc");

/*
gulp.task('default', function() {
    // place code for your default task here
});
*/
gulp.task('default', ['typedoc']); // or just run "gulp typedoc"

// http://typedoc.org/api/
gulp.task("typedoc", function() {
    return gulp
        .src(["src/**/*.ts"])
        .pipe(typedoc({
            module: "commonjs",
            target: "es6",
            //includeDeclarations: true,
            out: "docs/",
            name: "WolfBot",
            ignoreCompilerErrors: true,
            version: true,
            excludePrivate: true,
            excludeProtected: false
        }));
});