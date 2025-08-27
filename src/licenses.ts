import * as fs from 'fs';

// Types for our data structures
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface NpmPackageInfo {
  name: string;
  version: string;
  description?: string;
  homepage?: string;
  repository?: {
    type: string;
    url: string;
  };
  license?: string;
  author?: string | { name: string; email?: string };
  keywords?: string[];
  maintainers?: Array<{ name: string; email: string }>;
  time?: {
    created: string;
    modified: string;
    [version: string]: string;
  };
  downloads?: number;
  size?: number;
}

interface PackageAnalysis {
  name: string;
  installedVersion: string;
  latestVersion: string;
  description: string;
  license: string;
  author: string;
  homepage: string;
  repository: string;
  keywords: string[];
  maintainers: number;
  created: string;
  lastModified: string;
  isOutdated: boolean;
  securityIssues?: string[];
  dependencyType: 'dependency' | 'devDependency' | 'peerDependency';
}

interface AnalysisReport {
  totalPackages: number;
  outdatedPackages: number;
  packagesWithSecurityIssues: number;
  licenseDistribution: Record<string, number>;
  topMaintainers: Array<{ name: string; packages: number }>;
  packages: PackageAnalysis[];
}

class PackageAnalyzer {
  private _packages: PackageAnalysis[] = [];
  private readonly _npmRegistryUrl = 'https://registry.npmjs.org';
  private _requestCount = 0;
  private readonly _maxRequestsPerMinute = 50; // Rate limiting

  async analyzePackageJson(packageJsonPath: string): Promise<AnalysisReport> {
    console.log(`📦 Analyzing package.json at: ${packageJsonPath}`);

    // Read and parse package.json
    const packageJson = await this._readPackageJson(packageJsonPath);

    // Extract all dependencies
    const allDeps = this._extractDependencies(packageJson);
    console.log(`Found ${allDeps.length} total dependencies`);

    // Analyze each dependency
    this._packages = [];

    let processed = 0;

    for (const dep of allDeps) {
      try {
        console.log(`[${++processed}/${allDeps.length}] Analyzing ${dep.name}...`);

        const analysis = await this._analyzePackage(dep.name, dep.version, dep.type);
        this._packages.push(analysis);

        // Rate limiting
        if (this._requestCount % this._maxRequestsPerMinute === 0) {
          console.log('⏱️  Rate limiting... waiting 60 seconds');
          await this._sleep(60000);
        }

        // Small delay between requests
        await this._sleep(100);
      } catch (error) {
        console.error(`❌ Error analyzing ${dep.name}:`, error);
        // Add a minimal entry for failed packages
        this._packages.push({
          name: dep.name,
          installedVersion: dep.version,
          latestVersion: 'unknown',
          description: 'Failed to fetch information',
          license: 'unknown',
          author: 'unknown',
          homepage: '',
          repository: '',
          keywords: [],
          maintainers: 0,
          created: '',
          lastModified: '',
          isOutdated: false,
          dependencyType: dep.type,
        });
      }
    }

    return this._generateReport();
  }

  private async _readPackageJson(filePath: string): Promise<PackageJson> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to read package.json: ${error}`);
    }
  }

  private _extractDependencies(packageJson: PackageJson): Array<{
    name: string;
    version: string;
    type: 'dependency' | 'devDependency' | 'peerDependency';
  }> {
    const deps: Array<{
      name: string;
      version: string;
      type: 'dependency' | 'devDependency' | 'peerDependency';
    }> = [];

    // Regular dependencies
    if (packageJson.dependencies) {
      Object.entries(packageJson.dependencies).forEach(([name, version]) => {
        deps.push({ name, version, type: 'dependency' });
      });
    }

    // Dev dependencies
    if (packageJson.devDependencies) {
      Object.entries(packageJson.devDependencies).forEach(([name, version]) => {
        deps.push({ name, version, type: 'devDependency' });
      });
    }

    // Peer dependencies
    if (packageJson.peerDependencies) {
      Object.entries(packageJson.peerDependencies).forEach(([name, version]) => {
        deps.push({ name, version, type: 'peerDependency' });
      });
    }

    return deps;
  }

  private async _analyzePackage(
    name: string,
    installedVersion: string,
    type: 'dependency' | 'devDependency' | 'peerDependency',
  ): Promise<PackageAnalysis> {
    this._requestCount++;

    const packageInfo = await this._fetchPackageInfo(name);
    const latestVersion = packageInfo.version;

    // Clean version strings for comparison
    const cleanInstalled = this._cleanVersion(installedVersion);
    const isOutdated = this._isVersionOutdated(cleanInstalled, latestVersion);

    return {
      name,
      installedVersion,
      latestVersion,
      description: packageInfo.description || '',
      license: packageInfo.license || 'unknown',
      author: this._formatAuthor(packageInfo.author),
      homepage: packageInfo.homepage || '',
      repository: this._formatRepository(packageInfo.repository),
      keywords: packageInfo.keywords || [],
      maintainers: packageInfo.maintainers?.length || 0,
      created: packageInfo.time?.created || '',
      lastModified: packageInfo.time?.modified || '',
      isOutdated,
      dependencyType: type,
    };
  }

  private async _fetchPackageInfo(packageName: string): Promise<NpmPackageInfo> {
    const url = `${this._npmRegistryUrl}/${packageName}/latest`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      return data as NpmPackageInfo;
    } catch (error) {
      throw new Error(`Failed to fetch package info for ${packageName}: ${error}`);
    }
  }

  private _cleanVersion(version: string): string {
    // Remove common prefixes like ^, ~, >=, etc.
    return version.replace(/^[\^~>=<]/, '').trim();
  }

  private _isVersionOutdated(installed: string, latest: string): boolean {
    try {
      // Simple version comparison (this could be enhanced with a proper semver library)
      const installedParts = installed.split('.').map(Number);
      const latestParts = latest.split('.').map(Number);

      for (let i = 0; i < Math.max(installedParts.length, latestParts.length); i++) {
        const installedPart = installedParts[i] || 0;
        const latestPart = latestParts[i] || 0;

        if (installedPart < latestPart) {
          return true;
        }

        if (installedPart > latestPart) {
          return false;
        }
      }

      return false;
    } catch {
      return false; // If we can't compare, assume it's not outdated
    }
  }

  private _formatAuthor(author: string | { name: string; email?: string } | undefined): string {
    if (!author) {
      return 'unknown';
    }

    if (typeof author === 'string') {
      return author;
    }

    return author.name;
  }

  private _formatRepository(repo: { type: string; url: string } | undefined): string {
    if (!repo) {
      return '';
    }

    return repo.url || '';
  }

  private _generateReport(): AnalysisReport {
    const totalPackages = this._packages.length;
    const outdatedPackages = this._packages.filter((p) => p.isOutdated).length;

    // License distribution
    const licenseDistribution: Record<string, number> = {};
    this._packages.forEach((pkg) => {
      const license = pkg.license || 'unknown';
      licenseDistribution[license] = (licenseDistribution[license] || 0) + 1;
    });

    // Top maintainers (simplified - just count unique author names)
    const maintainerCount: Record<string, number> = {};
    this._packages.forEach((pkg) => {
      if (pkg.author && pkg.author !== 'unknown') {
        maintainerCount[pkg.author] = (maintainerCount[pkg.author] || 0) + 1;
      }
    });

    const topMaintainers = Object.entries(maintainerCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, packages]) => ({ name, packages }));

    return {
      totalPackages,
      outdatedPackages,
      packagesWithSecurityIssues: 0, // Would require additional security API calls
      licenseDistribution,
      topMaintainers,
      packages: this._packages,
    };
  }

  generateReportFile(report: AnalysisReport, outputPath: string): void {
    console.log('\n📊 Generating analysis report...');

    let reportContent = `# Package Dependency Analysis Report\n\n`;
    reportContent += `Generated on: ${new Date().toISOString()}\n\n`;

    // Summary
    reportContent += `## Summary\n\n`;
    reportContent += `- **Total Packages**: ${report.totalPackages}\n`;
    reportContent += `- **Outdated Packages**: ${report.outdatedPackages} (${((report.outdatedPackages / report.totalPackages) * 100).toFixed(1)}%)\n\n`;

    // License Distribution
    reportContent += `## License Distribution\n\n`;
    Object.entries(report.licenseDistribution)
      .sort(([, a], [, b]) => b - a)
      .forEach(([license, count]) => {
        const percentage = ((count / report.totalPackages) * 100).toFixed(1);
        reportContent += `- **${license}**: ${count} packages (${percentage}%)\n`;
      });

    // Top Maintainers
    if (report.topMaintainers.length > 0) {
      reportContent += `\n## Top Package Authors\n\n`;
      report.topMaintainers.forEach((maintainer) => {
        reportContent += `- **${maintainer.name}**: ${maintainer.packages} packages\n`;
      });
    }

    // Outdated Packages
    const outdatedPkgs = report.packages.filter((p) => p.isOutdated);

    if (outdatedPkgs.length > 0) {
      reportContent += `\n## Outdated Packages\n\n`;
      reportContent += `| Package | Installed | Latest | Type |\n`;
      reportContent += `|---------|-----------|--------|----- |\n`;
      outdatedPkgs.forEach((pkg) => {
        reportContent += `| ${pkg.name} | ${pkg.installedVersion} | ${pkg.latestVersion} | ${pkg.dependencyType} |\n`;
      });
    }

    // All Packages Detail
    reportContent += `\n## All Packages\n\n`;
    reportContent += `| Package | Version | Latest | License | Author | Outdated |\n`;
    reportContent += `|---------|---------|--------|---------|---------|---------|\n`;

    report.packages
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((pkg) => {
        const outdatedIcon = pkg.isOutdated ? '⚠️' : '✅';
        const author = pkg.author.length > 20 ? pkg.author.substring(0, 20) + '...' : pkg.author;
        reportContent += `| ${pkg.name} | ${pkg.installedVersion} | ${pkg.latestVersion} | ${pkg.license} | ${author} | ${outdatedIcon} |\n`;
      });

    fs.writeFileSync(outputPath, reportContent);
    console.log(`📄 Report saved to: ${outputPath}`);
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Usage example and CLI interface
async function main() {
  console.log('\n✨ Analysis starting...');
  console.log('\n✨ (Npmjs.org may rate-limit and delay 60 seconds after 50 requests.  Be patient!)\n');

  const analyzer = new PackageAnalyzer();

  // Get package.json path from command line args or use default
  const packageJsonPath = process.argv[2] || './package.json';
  const outputPath = process.argv[3] || './dependency-analysis-report.md';

  try {
    console.log('🚀 Starting package dependency analysis...');

    const report = await analyzer.analyzePackageJson(packageJsonPath);

    // Generate and save report
    analyzer.generateReportFile(report, outputPath);

    // Print summary to console
    console.log('\n✨ Analysis complete!');
    console.log(`📦 Total packages analyzed: ${report.totalPackages}`);
    console.log(`⚠️  Outdated packages: ${report.outdatedPackages}`);
    console.log(`📄 Full report saved to: ${outputPath}`);
  } catch (error) {
    console.error('❌ Error during analysis:', error);
    process.exit(1);
  }
}

// Export the analyzer class for use as a module
export { PackageAnalyzer };
export type { PackageAnalysis, AnalysisReport };

// Run if this file is executed directly
// In ES modules, we can check if this file is the entry point
if (process.argv[1]?.endsWith('licenses.ts') || process.argv[1]?.endsWith('licenses.js')) {
  main().catch(console.error);
}

export { main };
