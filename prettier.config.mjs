/**
 * Prettier configuration.
 *
 * The non-default choices below are deliberate: they keep the character this
 * codebase already had, so the one-time reformat stays a formatting change and
 * does not quietly become a style rewrite as well.
 *
 * @type {import("prettier").Config}
 */
export default {
	// Tabs let each reader pick their own indent width, and the codebase was
	// already tab-indented throughout.
	useTabs: true,
	tabWidth: 4,

	// The source has been semicolon free from the start (19 stray ones in 21k
	// lines). Prettier inserts a protective leading semicolon on the few lines
	// that would otherwise continue the previous statement, so this stays safe.
	semi: false,

	// Matches the existing source and Prettier's own default.
	singleQuote: false,

	// 80 shreds this code: the DOM and React hook call sites are genuinely long.
	printWidth: 110,

	// Prettier 3 default. Keeps diffs to a single line when an item is added.
	trailingComma: "all",

	// Prettier's default, and it means adding a type to an arrow parameter is a
	// local edit rather than also having to add the parentheses.
	arrowParens: "always",

	// Git already normalises on commit; this keeps the working tree consistent
	// for anyone not relying on autocrlf.
	endOfLine: "lf",

	overrides: [
		{
			// Yaml cannot be tab indented, so prettier falls back to spaces and
			// would use tabWidth above. Two is what .editorconfig asks for and
			// what workflow files are written with everywhere else.
			files: ["*.yml", "*.yaml"],
			options: { tabWidth: 2 },
		},
	],
}
