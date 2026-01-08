# QA Framework Generator

An AI-powered web application that generates complete test automation frameworks and executes them in real-time. Point it at any website, select your language and framework, and watch as Claude AI creates a professional test suite that you can run instantly.

![QA Framework Generator](https://img.shields.io/badge/AI-Powered-purple) ![Docker](https://img.shields.io/badge/Docker-Ready-blue) ![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **AI-Powered Generation**: Uses Claude AI to analyze websites and generate comprehensive test frameworks
- **Multiple Languages**: Support for Python, Java, and JavaScript
- **Multiple Frameworks**: Playwright, Selenium, Cypress, TestNG, JUnit, and more
- **Live Test Execution**: Run generated tests directly in the browser with real-time output streaming
- **Visual Test Reports**: Allure-style test reports with pass/fail metrics, duration, and expandable error details
- **Browser Selection**: Choose between Chromium, Firefox, or WebKit (Safari)
- **Headed/Headless Mode**: Watch tests run in a browser or run silently in the background
- **IDE-Style Code Viewer**: Browse generated files with syntax highlighting and line numbers
- **Download as ZIP**: Export your generated framework to use in your own projects
- **Docker Ready**: Fully containerized for consistent environments

## Screenshots

*Coming soon*

## Quick Start

### Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/) installed and running
- [Anthropic API Key](https://console.anthropic.com/)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/qa-framework-generator.git
   cd qa-framework-generator
   ```

2. **Create environment file**
   ```bash
   cp .env.example .env
   ```

3. **Add your Anthropic API key**
   ```bash
   # Edit .env and add your key
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```

4. **Build and run with Docker**
   ```bash
   docker compose up --build
   ```

5. **Open the app**
   
   Navigate to [http://localhost:3001](http://localhost:3001)

## Usage

1. **Configure your framework**
   - Select a programming language (Python, Java, JavaScript)
   - Choose a testing framework (Playwright, Selenium, etc.)
   - Enter the target website URL

2. **Generate the framework**
   - Click "Generate Framework"
   - Watch as Claude AI creates page objects, test cases, and configuration files

3. **Review the code**
   - Browse generated files in the IDE-style viewer
   - Files are organized by folder (pages/, tests/)

4. **Run the tests**
   - Select your browser (Chromium, Firefox, WebKit)
   - Toggle headed mode to watch tests run (or keep headless for speed)
   - Click "Run Tests" and watch real-time output

5. **View results**
   - See pass/fail metrics in the visual report
   - Expand individual tests to see error details
   - Download the framework as a ZIP for your own projects

## Project Structure

```
qa-framework-generator/
├── src/
│   └── App.jsx           # React frontend component
├── server.js             # Express backend server
├── Dockerfile            # Docker container configuration
├── docker-compose.yml    # Docker Compose orchestration
├── package.json          # Node.js dependencies
├── vite.config.js        # Vite build configuration
├── .env.example          # Environment variables template
└── README.md
```

## Development

### Running Locally (without Docker)

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start the development servers**
   ```bash
   npm run dev:all
   ```
   This runs both the Vite dev server (frontend) and Express server (backend) concurrently.

3. **Or run them separately**
   ```bash
   # Terminal 1 - Frontend
   npm run dev
   
   # Terminal 2 - Backend
   npm run dev:server
   ```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Yes |
| `PORT` | Server port (default: 3001) | No |
| `NODE_ENV` | Environment (production/development) | No |

## Tech Stack

**Frontend**
- React 18
- Vite
- Custom CSS (no framework)

**Backend**
- Node.js
- Express
- Anthropic Claude API
- Server-Sent Events (SSE) for streaming

**Testing Infrastructure**
- Python virtual environments
- Playwright (with Chromium, Firefox, WebKit)
- pytest with JSON reporting
- Xvfb for headed mode in Docker

**DevOps**
- Docker & Docker Compose
- Multi-stage builds

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/generate` | POST | Generate test framework using Claude AI |
| `/api/run-tests` | POST | Execute tests and stream results via SSE |
| `/api/download-zip` | POST | Download generated files as ZIP |
| `/api/health` | GET | Health check endpoint |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Roadmap

- [ ] Syntax highlighting in code viewer
- [ ] Support for more testing frameworks
- [ ] Site crawler for automatic element detection
- [ ] GitHub integration (push generated frameworks directly)
- [ ] Test history and comparison
- [ ] Custom prompt templates
- [ ] CI/CD pipeline templates

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Anthropic](https://anthropic.com) for the Claude API
- [Playwright](https://playwright.dev) for browser automation
- [Sauce Demo](https://saucedemo.com) for providing a great test target site

## Author

**Jim Gray** - QA Engineer

- LinkedIn: [Connect with me](https://linkedin.com/in/jgray00)

---

Built with Claude AI and a lot of ☕
