export const APT_VERSION = 'apt 2.7.14 (amd64)';

const FOOTER = `See apt(8) for more information about the available commands.
Configuration options and syntax is detailed in apt.conf(5).
Information about how to configure sources can be found in sources.list(5).
Package and version choices can be expressed via apt_preferences(5).
Security details are available in apt-secure(8).
                                        This APT has Super Cow Powers.
`;

const APT = `Usage: apt [options] command

apt is a commandline package manager and provides commands for
searching and managing as well as querying information about packages.
It provides the same functionality as the specialized APT tools,
like apt-get and apt-cache, but enables options more suitable for
interactive use by default.

Most used commands:
  list - list packages based on package names
  search - search in package descriptions
  show - show package details
  install - install packages
  remove - remove packages
  autoremove - automatically remove all unused packages
  update - update list of available packages
  upgrade - upgrade the system by installing/upgrading packages
  full-upgrade - upgrade the system by removing/installing/upgrading packages
`;

const APT_GET = `Usage: apt-get [options] command
       apt-get [options] install|remove pkg1 [pkg2 ...]

apt-get is a command line interface for retrieval of packages
and information about them from authenticated sources and
for installation, upgrade and removal of packages together
with their dependencies.

Most used commands:
  update - Retrieve new lists of packages
  upgrade - Perform an upgrade
  install - Install new packages (pkg is libc6 not libc6.deb)
  remove - Remove packages
  purge - Remove packages and config files
  autoremove - Remove automatically all unused packages
  dist-upgrade - Distribution upgrade, see apt-get(8)
  clean - Erase downloaded archive files
  autoclean - Erase old downloaded archive files
`;

const APT_CACHE = `Usage: apt-cache [options] command
       apt-cache [options] show pkg1 [pkg2 ...]

apt-cache queries and displays available information about installed
and installable packages. It works exclusively on the data acquired
into the local cache via the 'update' command of e.g. apt-get.

Most used commands:
  search - search the package list for a regex pattern
  show - show package records
  policy - show policy settings
`;

export function usage(tool: string): string {
  const body = tool === 'apt-get' ? APT_GET : tool === 'apt-cache' ? APT_CACHE : APT;
  return `${APT_VERSION}\n${body}\n${FOOTER.replace('apt(8)', `${tool}(8)`)}`;
}
