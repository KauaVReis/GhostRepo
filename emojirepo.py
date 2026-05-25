#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
EMOJIGHOST CLI - Ferramenta de Esteganografia Unicode
Compatível com a versão Web (HTML/JS)
"""

import os
import sys
import gzip
import hashlib
import urllib.request
import argparse
import zipfile
import io

# Configurações de Codificação (Compatíveis com JS)
ANCHOR_EMOJI = "😀"
CODEPOINT_START = 0xE0100


def log_info(msg):
    print(f"  \033[94m⚡\033[0m \033[90m| \033[37m{msg}\033[0m")


def log_success(msg):
    print(f"  \033[92m✔\033[0m \033[90m| \033[92m{msg}\033[0m")


def log_error(msg):
    print(
        f"  \033[91m✖\033[0m \033[90m| \033[91m{msg}\033[0m", file=sys.stderr)


def calculate_sha256(data: bytes) -> str:
    """Calcula o checksum SHA-256 de um bloco de bytes."""
    return hashlib.sha256(data).hexdigest()


def encode_bytes_to_invisible(data: bytes) -> str:
    """Converte bytes para caracteres Unicode invisíveis (U+E0100 a U+E010F)."""
    chars = []
    for byte in data:
        high_nibble = (byte >> 4) & 0x0F
        low_nibble = byte & 0x0F
        chars.append(chr(CODEPOINT_START + high_nibble))
        chars.append(chr(CODEPOINT_START + low_nibble))
    return "".join(chars)


def decode_invisible_to_bytes(text: str) -> bytes:
    """Converte caracteres Unicode invisíveis de volta para bytes."""
    nibbles = []
    for char in text:
        cp = ord(char)
        if CODEPOINT_START <= cp <= (CODEPOINT_START + 0x0F):
            nibbles.append(cp - CODEPOINT_START)

    if len(nibbles) % 2 != 0:
        raise ValueError(
            "Payload corrompido: número ímpar de caracteres invisíveis.")

    data = bytearray(len(nibbles) // 2)
    for i in range(len(data)):
        high = nibbles[i * 2]
        low = nibbles[i * 2 + 1]
        data[i] = (high << 4) | low
    return bytes(data)


def parse_github_repo(input_str: str):
    """
    Retorna (user, repo) se for um repositório válido, ou levanta ValueError.
    Exemplos suportados:
      - KauaVReis/GhostRepo
      - https://github.com/KauaVReis/GhostRepo.git
      - github.com/KauaVReis/GhostRepo/
    """
    s = input_str.strip().strip('\'"').rstrip('/')
    if s.lower().endswith('.git'):
        s = s[:-4]

    if 'github.com/' in s:
        parts = s.split('github.com/')
        path = parts[1]
    else:
        path = s

    if path.startswith('http://') or path.startswith('https://'):
        path = path.split('://', 1)[1]

    path_parts = [p for p in path.split('/') if p]
    if len(path_parts) >= 2:
        return path_parts[0], path_parts[1]

    raise ValueError(
        "Formato de repositório inválido. Use 'usuario/repositorio' ou a URL completa do GitHub.")


def download_github_zip(repo_url: str) -> bytes:
    """Baixa o ZIP de um repositório GitHub público."""
    user, repo = parse_github_repo(repo_url)

    # Tentar baixar de main ou master
    branches = ['main', 'master']
    last_err = None

    for branch in branches:
        download_url = f"https://github.com/{user}/{repo}/archive/refs/heads/{branch}.zip"
        log_info(f"Tentando baixar branch '{branch}' de: {download_url}")

        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        req = urllib.request.Request(download_url, headers=headers)

        try:
            with urllib.request.urlopen(req) as response:
                if response.status == 200:
                    zip_data = response.read()
                    if len(zip_data) > 100:
                        log_success(
                            f"Branch '{branch}' baixada com sucesso ({len(zip_data)} bytes).")
                        return zip_data
        except Exception as e:
            last_err = e

    raise RuntimeError(f"Falha ao baixar o repositório: {last_err}")


def run_encode(source: str, output_file: str, use_compression: bool, extreme: bool):
    """Executa o processo de encode."""
    source = source.strip().strip('\'"')
    output_file = output_file.strip().strip('\'"')

    # Decidir se é GitHub
    is_github = False
    if source.startswith("http://") or source.startswith("https://") or "github.com" in source:
        is_github = True
    elif "/" in source and not os.path.exists(source) and not source.lower().endswith(".zip"):
        is_github = True

    # Obter os bytes do ZIP
    if is_github:
        try:
            zip_bytes = download_github_zip(source)
        except Exception as e:
            log_error(f"Erro ao obter repositório GitHub: {e}")
            return
    else:
        if not os.path.exists(source):
            log_error(f"Arquivo local não encontrado: {source}")
            return
        log_info(f"Lendo arquivo ZIP local: {source}")
        with open(source, 'rb') as f:
            zip_bytes = f.read()

    original_size = len(zip_data := zip_bytes)
    sha256_hex = calculate_sha256(zip_data)
    log_info(f"SHA-256 original: {sha256_hex}")

    # Compressão opcional
    is_compressed = 0
    if use_compression:
        log_info("Comprimindo dados com Gzip...")
        zip_bytes = gzip.compress(zip_bytes)
        is_compressed = 1
        log_info(f"Tamanho comprimido: {len(zip_bytes)} bytes")

    # Montagem do buffer do payload
    # [1 byte flag] + [32 bytes hash] + [dados ZIP]
    sha_bytes = bytes.fromhex(sha256_hex)
    payload = bytearray()
    payload.append(is_compressed)
    payload.extend(sha_bytes)
    payload.extend(zip_bytes)

    # Codificação invisível
    log_info("Codificando payload para caracteres invisíveis...")
    invisible_text = encode_bytes_to_invisible(payload)

    # Adicionar emoji âncora se não for modo extremo
    final_output = invisible_text if extreme else ANCHOR_EMOJI + invisible_text

    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(final_output)

    log_success(f"Esteganografia concluída!")
    print(f"  Arquivo gerado: {output_file}")
    print(f"  Tamanho original: {original_size} bytes")
    print(f"  Caracteres invisíveis: {len(final_output)}")


def run_decode(input_file: str, output_zip: str, extract: bool = False):
    """Executa o processo de decode."""
    if not os.path.exists(input_file):
        log_error(f"Arquivo não encontrado: {input_file}")
        return

    log_info(f"Lendo arquivo esteganográfico: {input_file}")
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()

    log_info("Extraindo e decodificando caracteres invisíveis...")
    try:
        payload_bytes = decode_invisible_to_bytes(content)
    except Exception as e:
        log_error(f"Erro na extração Unicode: {e}")
        return

    if len(payload_bytes) < 33:
        log_error("Payload muito curto ou corrompido.")
        return

    # Desestruturando o payload
    is_compressed = payload_bytes[0] & 0x01
    expected_sha = payload_bytes[1:33].hex()
    data_bytes = payload_bytes[33:]

    # Descompressão se necessário
    if is_compressed:
        log_info("Descompactando payload (Gzip)...")
        try:
            data_bytes = gzip.decompress(data_bytes)
        except Exception as e:
            log_error(f"Falha na descompressão Gzip: {e}")
            return

    # Verificando integridade
    calculated_sha = calculate_sha256(data_bytes)
    log_info(f"SHA-256 calculado: {calculated_sha}")
    log_info(f"SHA-256 esperado:  {expected_sha}")

    if calculated_sha == expected_sha:
        log_success(
            "Verificação de Integridade: OK (Checksum bate perfeitamente!)")
    else:
        log_error(
            "ALERTA: O hash do arquivo decodificado difere do original. Arquivo corrompido!")

    with open(output_zip, 'wb') as f:
        f.write(data_bytes)

    log_success(f"Arquivo ZIP original restaurado em: {output_zip}")

    if extract:
        log_info("Extraindo arquivos do ZIP...")
        dest_dir = output_zip[:-4] if output_zip.lower().endswith(
            '.zip') else output_zip + "_extracted"
        try:
            with zipfile.ZipFile(io.BytesIO(data_bytes)) as z:
                z.extractall(dest_dir)
            log_success(f"Arquivos extraídos com sucesso na pasta: {dest_dir}")
        except Exception as e:
            log_error(f"Falha ao extrair o ZIP: {e}")


def interactive_menu():
    print("\033[95m" + r"""
  ______                 _ _  _____ _               _
 |  ____|               (_|_) / ____| |             | |
 | |__   _ __ ___   ___  _ _ | |  __| |__   ___  ___| |_
 |  __| | '_ ` _ \ / _ \| | || | |_ | '_ \ / _ \/ __| __|
 | |____| | | | | | (_) | | || |__| | | | | (_) \__ \ |_
 |______|_| |_| |_|\___/| | | \_____|_| |_|\___/|___/\__|
                       _/ |
                      |__/
""" + "\033[0m")
    print(
        "\033[90m------------------------------------------------------------\033[0m")
    print("  \033[93m⚡ EMOJIGHOST CLI - Esteganografia Unicode ⚡\033[0m")
    print(
        "\033[90m------------------------------------------------------------\033[0m")
    while True:
        print("\n\033[96m[ Menu Principal ]\033[0m")
        print(
            "  \033[94m1\033[0m - Esconder dados (ZIP/GitHub) -> Emoji (\033[92mEncode\033[0m)")
        print(
            "  \033[94m2\033[0m - Extrair dados (Emoji) -> ZIP (\033[92mDecode\033[0m)")
        print("  \033[94m3\033[0m - Sair")
        print("\033[90m" + "-"*50 + "\033[0m")

        choice = input("\033[93mEscolha uma opção (1-3): \033[0m").strip()

        if choice == '1':
            source = input(
                "\n\033[96mDigite a URL do repositório GitHub ou caminho do ZIP local:\033[0m\n> ").strip().strip('\'"')
            if not source:
                log_error("Fonte inválida!")
                continue

            # Autocompletar extensão de ZIP local por conveniência se não for link do GitHub
            is_github = False
            if source.startswith("http://") or source.startswith("https://") or "github.com" in source:
                is_github = True
            elif "/" in source and not os.path.exists(source) and not source.lower().endswith(".zip"):
                # Pode ser formato curto usuario/repositorio
                is_github = True

            if not is_github:
                if not source.lower().endswith('.zip') and not os.path.exists(source):
                    source += '.zip'

            output = input(
                "\033[96mDigite o nome do arquivo de saída [.txt] (padrão: emoji.txt):\033[0m\n> ").strip().strip('\'"')
            if not output:
                output = "emoji.txt"
            elif not output.lower().endswith('.txt'):
                output += '.txt'

            compress_opt = input(
                "\033[96mAtivar compressão GZip? (S/n):\033[0m ").strip().lower()
            use_compress = compress_opt != 'n'

            extreme_opt = input(
                "\033[96mAtivar Modo Invisível Extremo (sem emoji âncora)? (s/N):\033[0m ").strip().lower()
            extreme = extreme_opt == 's'

            print("\n\033[94m⚙ Preparando codificação...\033[0m")
            run_encode(source, output, use_compress, extreme)

        elif choice == '2':
            input_file = input(
                "\n\033[96mDigite o caminho do arquivo de entrada [.txt] (padrão: emoji.txt):\033[0m\n> ").strip().strip('\'"')
            if not input_file:
                input_file = "emoji.txt"
            elif not input_file.lower().endswith('.txt'):
                input_file += '.txt'

            output_zip = input(
                "\033[96mDigite o nome do ZIP de saída (padrão: projeto_restaurado.zip):\033[0m\n> ").strip().strip('\'"')
            if not output_zip:
                output_zip = "projeto_restaurado.zip"
            elif not output_zip.lower().endswith('.zip'):
                output_zip += '.zip'

            extract_opt = input(
                "\033[96mDeseja extrair (unzip) os arquivos do ZIP restaurado? (S/n):\033[0m ").strip().lower()
            extract = extract_opt != 'n'

            print("\n\033[94m⚙ Preparando decodificação...\033[0m")
            run_decode(input_file, output_zip, extract)

        elif choice == '3':
            print("\n\033[95mSaindo... Até logo! ⚡\033[0m\n")
            break
        else:
            log_error("Opção inválida! Tente novamente.")


def main():
    if len(sys.argv) == 1:
        interactive_menu()
        return

    parser = argparse.ArgumentParser(
        description="EMOJIGHOST CLI - Codifique e Decodifique ZIPs e repositórios GitHub em emojis invisíveis.")
    subparsers = parser.add_subparsers(
        dest="command", help="Comandos disponíveis")

    # Parser do comando encode
    encode_parser = subparsers.add_parser(
        "encode", help="Esconde um ZIP ou repositório GitHub atrás de caracteres invisíveis.")
    encode_parser.add_argument(
        "source", help="URL do repositório GitHub público OU caminho de um arquivo .zip local.")
    encode_parser.add_argument("-o", "--output", default="emoji.txt",
                               help="Caminho do arquivo .txt de saída (padrão: emoji.txt).")
    encode_parser.add_argument(
        "--no-compress", action="store_true", help="Desativa a compressão Gzip do payload.")
    encode_parser.add_argument("--extreme", action="store_true",
                               help="Ativa o modo invisível extremo (sem emoji visível de âncora).")

    # Parser do comando decode
    decode_parser = subparsers.add_parser(
        "decode", help="Restaura um arquivo ZIP a partir de um arquivo de esteganografia.")
    decode_parser.add_argument(
        "input", help="Caminho do arquivo .txt esteganográfico contendo o payload.")
    decode_parser.add_argument("-o", "--output", default="projeto_restaurado.zip",
                               help="Caminho do arquivo .zip de saída (padrão: projeto_restaurado.zip).")
    decode_parser.add_argument("-x", "--extract", action="store_true",
                               help="Extrai (unzip) o arquivo ZIP resultante em uma pasta.")

    args = parser.parse_args()

    if args.command == "encode":
        run_encode(args.source, args.output,
                   not args.no_compress, args.extreme)
    elif args.command == "decode":
        run_decode(args.input, args.output, args.extract)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
