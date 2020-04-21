import { getRepository, getCustomRepository, In } from 'typeorm';

import csvParse from 'csv-parse';

// Abrir arquivo, ler, etc.
import fs from 'fs';
import Transaction from '../models/Transaction';
import Category from '../models/Category';

import TransactionsRepository from '../repositories/TransactionsRepository';

interface CSVTransactions {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const transactionRepository = getCustomRepository(TransactionsRepository);
    const categoriesRepository = getRepository(Category);

    // Stream que irá ler o arquivo
    const contactsReadStram = fs.createReadStream(filePath);

    // Instanciando o csvParse, passando algumas configurações
    const parsers = csvParse({
      delimiter: ',', // Delimitador (vai até achar a ",")
      from_line: 2, // Começa a leitura do arquivo na linha 2
    });

    // Irá lendo conforme a configuração setada assim que a linha tiver disponível
    const parseCSV = contactsReadStram.pipe(parsers);

    const transactions: CSVTransactions[] = [];
    const categories: string[] = [];

    /**
     * 1º parâmetro: evento
     * 2º parâmetro: uma função
     * Função para pegar os atributos, retirando as linhas em branco
     */
    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      if (!title || !type || !value) return;

      // Salvando na variável para no final armazenar no B.D
      categories.push(category);
      transactions.push({ category, title, type, value });
    });

    // Verifica o terḿino do mapeamento do arquivo
    await new Promise(resolve => parseCSV.on('end', resolve));

    // Verificando se existe as categorias já cadastrada no B.D
    const existentCategories = await categoriesRepository.find({
      where: {
        // In => Verifica se existem estes dados de uma vez só
        title: In(categories),
      },
    });

    // Pegando somente os títulos
    const existentCategoriesTitles = existentCategories.map(
      (category: Category) => category.title,
    );

    // Pegando as categorias que não existem no B.D
    const addCategoryTitles = categories
      .filter(category => !existentCategoriesTitles.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);

    // Salvando as novas categorias, na forma de um objeto com atributo title
    const newCategories = categoriesRepository.create(
      addCategoryTitles.map(title => ({
        title,
      })),
    );

    await categoriesRepository.save(newCategories);

    const finalCategories = [...newCategories, ...existentCategories];

    // Criando as transações
    const createdTransactions = transactionRepository.create(
      transactions.map(t => ({
        title: t.title,
        type: t.type,
        value: t.value,
        category: finalCategories.find(
          category => category.title === t.category,
        ),
      })),
    );

    await transactionRepository.save(createdTransactions);

    await fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;

/**
 * lib CSV parser: manipular arquivo csv
 *
 * Bulk Insert => salva os dados em varíaveis, e depois salva tudo de uma vez
 * no B.D, ao invés de ficar salvando um por um, pois cada salvamento, abre uma conexão com B.D e fecha-se no final
 * perdendo perfomance..
 *
 * por isso salva td em uma varíavel, e no final armazena td de uma vez
 *
 *
 * parserCSV não é síncrono,
 * cria-se uma promise com a finalidade de verificar o parser CSV emetiu um evento 'end', dizendo que ja finalizou o
 * mapeamento do arquivo
 */
