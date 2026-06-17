{
  description = "Portable JSONL-to-XLSX engine";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        packages.default = pkgs.python3Packages.buildPythonPackage {
          pname = "jsonxlsx";
          version = "0.1.0";
          src = ./.;

          propagatedBuildInputs = with pkgs.python3Packages; [
            openpyxl
          ];

          nativeCheckInputs = with pkgs.python3Packages; [
            pytest
            pytest-cov
          ];

          checkPhase = ''
            pytest tests/ -v
          '';
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs.python3Packages; [
            python3
            openpyxl
            pytest
            pytest-cov
          ] ++ (with pkgs; [
            git
          ]);

          shellHook = ''
            export PYTHONPATH="${self}:$PYTHONPATH"
          '';
        };

        checks.x86_64-linux = {
          jsonxlsx-tests = self.packages.x86_64-linux.default;
        };
      }
    );
}
