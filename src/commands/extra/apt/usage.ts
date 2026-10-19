export const APT_VERSION = 'apt 2.7.14 (amd64)';

const FOOTER = `Full command reference: apt(8). Config file format: apt.conf(5).
Repository setup: sources.list(5). Version pinning: apt_preferences(5).
Signature checking: apt-secure(8).
`;

const APT = `Usage: apt [options] command

Front end for finding, installing and removing Debian packages. It wraps
the apt-get and apt-cache tools behind one command with defaults tuned
for people typing at a terminal.

Common commands:
  list - print packages whose names match a pattern
  search - look for a term in package descriptions
  show - print the metadata of a package
  install - add packages to the system
  remove - take packages off the system
  autoremove - drop dependencies nothing needs anymore
  update - refresh the index of available packages
  upgrade - move installed packages to newer versions
  full-upgrade - upgrade, adding or removing packages if required
`;

const APT_GET = `Usage: apt-get [options] command
       apt-get [options] install|remove pkg1 [pkg2 ...]

Low-level package tool: fetches packages from signed repositories and
installs, upgrades or removes them along with whatever they depend on.

Common commands:
  update - refresh the package index
  upgrade - upgrade installed packages
  install - add packages (give the name, e.g. libc6, not a .deb file)
  remove - uninstall packages
  purge - uninstall packages and delete their config
  autoremove - drop dependencies nothing needs anymore
  dist-upgrade - upgrade, adding or removing packages if required
  clean - empty the downloaded archive cache
  autoclean - delete cached archives that are out of date
`;

const APT_CACHE = `Usage: apt-cache [options] command
       apt-cache [options] show pkg1 [pkg2 ...]

Reads the local package index (built by 'apt-get update') and reports on
packages that are installed or available to install.

Common commands:
  search - match a regex against the package list
  show - print package records
  policy - print priorities and candidate versions
`;

export function usage(tool: string): string {
  const body = tool === 'apt-get' ? APT_GET : tool === 'apt-cache' ? APT_CACHE : APT;
  return `${APT_VERSION}\n${body}\n${FOOTER.replace('apt(8)', `${tool}(8)`)}`;
}
