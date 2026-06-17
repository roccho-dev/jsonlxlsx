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
          format = "pyproject";

          propagatedBuildInputs = with pkgs.python3Packages; [
            openpyxl
            flit-core
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
            openpyxl
            pytest
            pytest-cov
            flit-core
          ] ++ (with pkgs; [
            python3
            git
          ]);

          shellHook = ''
            export PYTHONPATH="${self}:$PYTHONPATH"
          '';
        };

        checks = {
          jsonxlsx-tests = self.packages.${system}.default;
        };
      }
    );
}
