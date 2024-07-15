#!/usr/bin/python3
import re
import pyperclip

print("Digite o nome:")

name = input()

# remover caracteres especiais
name = name.translate({ord(c): "" for c in "!@#$%^&*()[]{};:,./<>?\|`~-=_+"})

# remover mais alguns
name = re.sub(r"[àâáã]", 'a', name)
name = re.sub(r"[éêẽ]", 'e', name)
name = re.sub(r"[íîĩ]", 'i', name)
name = re.sub(r"[óõô]", 'o', name)
name = re.sub(r"[úûũ]", 'u', name)
name = re.sub(r"[ç]", 'c', name)

name = "feature/" + name.replace(" ", "-")

print("Nome formatado:")
print(name)

pyperclip.copy(name)

print("(copiado para o clipboard)")
