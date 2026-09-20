# Contributing to OpenCode Browser MCP Plugin

Thank you for your interest in contributing to this project! This guide will help you get started.

## Ways to Contribute

1. **Report Bugs** - Found an issue? Let us know!
2. **Suggest Features** - Have an idea? Share it!
3. **Write Documentation** - Help others understand the plugin
4. **Submit Code** - Fix bugs or add features
5. **Share Examples** - Add useful automation examples

## Development Setup

### Prerequisites

- Node.js v18 or higher
- OpenCode v2 installed (for v1, work from the upstream `opencode-browser` project)
- Browser MCP extension installed
- Git

### Local Setup

1. Clone the repository:
```bash
git clone https://github.com/barrenechea/opencode-browser-v2.git
cd opencode-browser-v2
```

2. Install dependencies:
```bash
npm install
```

3. Link the plugin locally:
```bash
# For testing. OpenCode v2 discovers local plugins from .opencode/plugins/
mkdir -p .opencode/plugins
ln -s $(pwd)/src/index.ts .opencode/plugins/browser-mcp.ts
```

4. Create your OpenCode configuration:
```bash
cp opencode.json.example opencode.json
```

## Testing Your Changes

### Manual Testing

1. Make your changes to `src/index.ts`
2. Run `npm run typecheck`
3. Restart OpenCode
4. Test with browser automation prompts
5. Verify the changes work as expected

### Test Checklist

Before submitting, ensure:

- [ ] `npm run typecheck` passes
- [ ] The plugin's `id` and source appear in OpenCode's active plugin list
- [ ] Plugin loads without errors
- [ ] Basic browser navigation works
- [ ] Every registered hook and event subscription is exercised
- [ ] Session context is preserved across compaction
- [ ] Reloading or removing the plugin runs cleanup without errors
- [ ] No console errors or warnings
- [ ] Documentation is updated

## Code Style

### TypeScript Guidelines

- Use TypeScript for all code
- Enable strict type checking
- `npm run typecheck` runs TypeScript 7 (the Go-native compiler). Two things changed in
  TypeScript 6/7 that affect `tsconfig.json`: `rootDir` must be set explicitly whenever `outDir`
  is set, and the long-deprecated options `charset`, `importsNotUsedAsValues`, `keyofStringsOnly`,
  `noImplicitUseStrict`, `noStrictGenericChecks`, `out`, `preserveValueImports`,
  `suppressExcessPropertyErrors` and `suppressImplicitAnyIndexErrors` were removed outright.
- Add JSDoc comments for public APIs
- Use meaningful variable names
- Keep functions small and focused

### Example:

```typescript
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "opencode-browser-v2",
  async setup(ctx) {
    // Hooks receive one mutable event; mutate it in place to change behaviour.
    await ctx.tool.hook("execute.after", (event) => {
      if (event.tool.startsWith("browsermcp_")) {
        console.log(`Completed: ${event.tool}`)
      }
    })
  },
})
```

## Submitting Changes

### Pull Request Process

1. Fork the repository
2. Create a feature branch:
```bash
git checkout -b feature/your-feature-name
```

3. Make your changes
4. Add tests if applicable
5. Update documentation
6. Commit with a clear message:
```bash
git commit -m "feat: add custom browser tool for screenshots"
```

7. Push to your fork:
```bash
git push origin feature/your-feature-name
```

8. Open a Pull Request

### Commit Message Format

Use conventional commits:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

Examples:
```
feat: add screenshot comparison tool
fix: resolve session context preservation issue
docs: update installation instructions for Windows
```

## Adding New Features

### Custom Tools

To add a custom browser tool:

```typescript
return {
  tool: {
    browser_screenshot: tool({
      description: "Take a screenshot of the current page",
      args: {
        fullPage: tool.schema.boolean().optional(),
      },
      async execute(args, ctx) {
        // Implementation
        return "Screenshot saved"
      },
    }),
  },
}
```

### New Hooks

To add a new hook:

```typescript
return {
  "new.hook.name": async (input, output) => {
    // Implementation
  },
}
```

## Documentation Standards

### README.md Structure

- Clear, concise explanations
- Code examples for all features
- Troubleshooting section
- Links to related resources

### Code Comments

- Explain WHY, not WHAT
- Use JSDoc for public APIs
- Keep comments up-to-date

### Examples

Add practical examples to `EXAMPLES.md`:

```markdown
## Your Feature Name

### Use Case Description

```
Your example prompt here
```

Explanation of what happens.
```

## Review Process

### What We Look For

1. **Functionality** - Does it work as intended?
2. **Code Quality** - Is it well-written and maintainable?
3. **Documentation** - Is it properly documented?
4. **Tests** - Are edge cases handled?
5. **Breaking Changes** - Are they necessary and documented?

### Response Time

- We aim to review PRs within 3-5 days
- Complex changes may take longer
- Feel free to ping if no response after a week

## Getting Help

### Questions?

- Check existing issues and discussions
- Review the documentation
- Ask in the PR or issue comments
- Join the OpenCode Discord (if available)

### Resources

- [OpenCode Documentation](https://opencode.ai/docs/)
- [OpenCode Plugin Guide](https://opencode.ai/docs/plugins/)
- [Browser MCP Docs](https://docs.browsermcp.io/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

## Community Guidelines

### Be Respectful

- Treat everyone with respect
- Assume good intentions
- Provide constructive feedback
- Help others learn and grow

### Be Professional

- Keep discussions on-topic
- Avoid inflammatory language
- Respect different perspectives
- Follow the code of conduct

## Recognition

Contributors will be:
- Listed in the README
- Credited in release notes
- Appreciated by the community

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

Feel free to open an issue or discussion if you have questions about contributing!

---

Thank you for contributing to OpenCode Browser MCP Plugin!
