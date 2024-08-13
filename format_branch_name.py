#!/usr/bin/python3
import re
import pyperclip
import beaupy

print("Digite o nome:")

name = input()

# remover caracteres especiais
name = name.translate({ord(c): "" for c in R"!@#$%^&*()[]{};:,./<>?\|`~-=_+"})

# remover mais alguns
name = re.sub(r"[àâáã]", 'a', name)
name = re.sub(r"[éêẽ]", 'e', name)
name = re.sub(r"[íîĩ]", 'i', name)
name = re.sub(r"[óõô]", 'o', name)
name = re.sub(r"[úûũ]", 'u', name)
name = re.sub(r"[ç]", 'c', name)

branches_opts = [
    "feature",
    "fix",
    "hotfix"
]

opt = beaupy.select(options=branches_opts)

# simplify 'feature' to be 'feat'
if opt == "feature":
    opt = "feat"

name = opt + "/" + name.replace(" ", "-")

print("Nome formatado:")
print(name)

pyperclip.copy(name)

print("(copiado para o clipboard)")
